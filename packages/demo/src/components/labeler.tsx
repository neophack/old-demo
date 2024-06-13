import {
    Dropdown,
    IDropdownOption,
    Position,
    SpinButton,
    Toggle,
    StackItem,
    ShimmeredDetailsList,
    MarqueeSelection,
    Selection,
    TextField,
    PrimaryButton,
    DefaultButton,
    IconButton,
    Stack,
} from "@fluentui/react";
import { autorun, makeAutoObservable, reaction, runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import { CSSProperties, useCallback, useState } from "react";
import { GLOBAL_STATE } from "../state";
import { useConst } from "@fluentui/react-hooks";
// import { AdbFrameBuffer, AdbFrameBufferV2 } from "@yume-chan/adb";
import {  useEffect, useRef } from "react";
import { action,  computed } from "mobx";
import { Icons, RouteStackProps } from "../utils";
import { CommandBar, DemoModePanel, DeviceView } from "../components";
import { Adb, AdbFrameBuffer, AdbFrameBufferV1, AdbFrameBufferV2,  AdbFrameBufferForbiddenError, AdbFrameBufferUnsupportedVersionError } from "@yume-chan/adb";
import { BufferedReadableStream } from "@yume-chan/stream-extra";
import {replayActions, STATE,RecordedAction} from "./scrcpy";

import getConfig from "next/config";
let StreamSaver: typeof import("@yume-chan/stream-saver");
if (typeof window !== "undefined") {
    const {
        publicRuntimeConfig: { basePath },
    } = getConfig();
    // Can't use `import` here because ESM is read-only (can't set `mitm` field)
    StreamSaver = require("@yume-chan/stream-saver");
    StreamSaver.mitm = basePath + "/StreamSaver/mitm.html";
    // Pre-register the service worker for offline usage.
    // Request for service worker script won't go through another service worker
    // so can't be cached.
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register(basePath + "/StreamSaver/sw.js", {
            scope: basePath + "/StreamSaver/",
        });
    }
}

interface ListItem {
    key: string;
    name: string;
}

class LabelerPanelState {
    // items: ListItem[] = [];
    selectedItems: RecordedAction[] = [];
    contextMenuTarget: MouseEvent | undefined = undefined;
    imageData: ImageData | undefined = undefined;
    width = 0;
    height = 0;

    setImage(image: AdbFrameBuffer) {
        this.width = image.width;
        this.height = image.height;
        this.imageData = new ImageData(
            new Uint8ClampedArray(image.data),
            image.width,
            image.height
        );
    }

    constructor() {
        makeAutoObservable(this);
    }

    // addItem(name: string) {
    //     const newItem = { key: `${Date.now()}`, name };
    //     this.items.push(newItem);
    // }

    deleteSelectedItems() {
        STATE.recordedActions = STATE.recordedActions.filter(
            (item) => !this.selectedItems.includes(item)
        );
        this.selectedItems = [];
    }

    clearItems() {
        STATE.recordedActions = [];
    }
}

export class AdbXmlFetchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AdbXmlFetchError";
    }
}


 function saveFile(fileName: string, size?: number | undefined) {
    return StreamSaver!.createWriteStream(fileName, {
        size,
    }) as unknown as WritableStream<Uint8Array>;
}


interface Configs {
    MIN_DIST: number;
}

const configs: Configs = {
    MIN_DIST: 50, // Example value, adjust accordingly
};

class AndroidElement {
    id: string;
    bbox: [[number, number], [number, number]];
    attrib: string;

    constructor(id: string, bbox: [[number, number], [number, number]], attrib: string) {
        this.id = id;
        this.bbox = bbox;
        this.attrib = attrib;
    }
}

function getIdFromElement(elem: Element): string {
    const bounds = elem.getAttribute('bounds')!.slice(1, -1).split('][');
    const [x1, y1] = bounds[0].split(',').map(Number);
    const [x2, y2] = bounds[1].split(',').map(Number);
    const elemW = x2 - x1;
    const elemH = y2 - y1;

    let elemId: string;
    if (elem.hasAttribute('resource-id') && elem.getAttribute('resource-id')) {
        elemId = elem.getAttribute('resource-id')!.replace(':', '.').replace('/', '_');
    } else {
        elemId = `${elem.getAttribute('class')}_${elemW}_${elemH}`;
    }

    if (elem.hasAttribute('content-desc') && elem.getAttribute('content-desc') && elem.getAttribute('content-desc')!.length < 20) {
        const contentDesc = elem.getAttribute('content-desc')!.replace('/', '_').replace(' ', '').replace(':', '_');
        elemId += `_${contentDesc}`;
    }

    return elemId;
}

function traverseTree(xmlDoc: Document, elemList: AndroidElement[], attrib: string, addIndex: boolean = false): void {
    const xpathResult = xmlDoc.evaluate(`//*[@${attrib}="true"]`, xmlDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    for (let i = 0; i < xpathResult.snapshotLength; i++) {
        const node = xpathResult.snapshotItem(i) as Element;
        const bounds = node.getAttribute('bounds')!.slice(1, -1).split('][');
        const [x1, y1] = bounds[0].split(',').map(Number);
        const [x2, y2] = bounds[1].split(',').map(Number);
        const center: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];

        let elemId = getIdFromElement(node);
        if (node.parentNode && node.parentNode.nodeType === 1) {
            const parentPrefix = getIdFromElement(node.parentNode as Element);
            elemId = `${parentPrefix}_${elemId}`;
        }

        if (addIndex && node.hasAttribute('index')) {
            elemId += `_${node.getAttribute('index')}`;
        }

        let close = false;
        for (const e of elemList) {
            const bbox = e.bbox;
            const center_: [number, number] = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
            const dist = Math.sqrt(Math.pow(center[0] - center_[0], 2) + Math.pow(center[1] - center_[1], 2));
            if (dist <= configs.MIN_DIST) {
                close = true;
                break;
            }
        }

        if (!close) {
            elemList.push(new AndroidElement(elemId, [[x1, y1], [x2, y2]], attrib));
        }
    }
}


export async function getXmlViaSocket(adb: Adb, prefix: string, saveDir: string): Promise<string> {
    const dumpCommand = `uiautomator dump /sdcard/${prefix}.xml`;
    try {
        
        let stdout = await adb.subprocess.spawnAndWaitLegacy(dumpCommand.split(" "));

        let responseStr = stdout.trim();
        console.log(responseStr)
        if (!responseStr.includes(`UI hierchary dumped to: /sdcard/${prefix}.xml`)) {
            throw new AdbXmlFetchError("Failed to dump UI hierarchy.");
        }
        
    } catch (error) {
        if (error instanceof Error) {
            throw new AdbXmlFetchError(error.message);
        } else {
            throw new AdbXmlFetchError("An unknown error occurred.");
        }
    }
    const sync = await adb!.sync();
    
    try {
        const readable = await sync.read(`/sdcard/${prefix}.xml`);
        // @ts-ignore ReadableStream definitions are slightly incompatiblereadable
        
        // Convert ReadableStream to Blob
        const response = new Response(readable);
        const blob = await response.blob();

        // Convert Blob to string
        const text = await blob.text();
        return text
        

    } finally {
        sync.dispose();
    }
    return ""
    
}

const state = new LabelerPanelState();

export interface LabelerPanelProps {
    style?: CSSProperties;
}

export const LabelerPanel = observer(({ style }: LabelerPanelProps) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [elements, setElements] = useState<AndroidElement[]>([]);

    const capture = useCallback(async () => {
        if (!GLOBAL_STATE.adb) {
            return;
        }

        try {
            const start = Date.now();
            const framebuffer = await GLOBAL_STATE.adb.framebuffer();
            console.log(
                "Framebuffer speed",
                (
                    (((AdbFrameBufferV2.size + framebuffer.size) /
                        (Date.now() - start)) *
                        1000) /
                    1024 /
                    1024
                ).toFixed(2),
                "MB/s"
            );
            state.setImage(framebuffer);
        } catch (e: any) {
            GLOBAL_STATE.showErrorDialog(e);
        }
    }, []);
    const replayAction = useCallback(async () => {
        if (!GLOBAL_STATE.adb) {
            return;
        }

        try {
            replayActions();
        } catch (e: any) {
            GLOBAL_STATE.showErrorDialog(e);
        }
    }, []);
    

    function drawBboxMulti( elemList: AndroidElement[], recordMode = false, darkMode = false): void {
        elemList.forEach((elem, index) => {
            try {
                const topLeft = elem.bbox[0];
                const bottomRight = elem.bbox[1];
                const left = topLeft[0];
                const top = topLeft[1];
                const right = bottomRight[0];
                const bottom = bottomRight[1];
                const label = (index + 1).toString();
                let color: string;

                if (recordMode) {
                    if (elem.attrib === 'clickable') {
                        color = 'rgba(250, 0, 0, 0.5)';
                    } else if (elem.attrib === 'focusable') {
                        color = 'rgba(0, 0, 250, 0.5)';
                    } else {
                        color = 'rgba(0, 250, 0, 0.5)';
                    }
                } else {
                    color = darkMode ? 'rgba(250, 10, 10, 0.5)' : 'rgba(0, 250, 250, 0.5)';
                }
                const canvas = canvasRef.current;
                if (canvas && state.imageData) {
                    const ctx = canvas.getContext('2d');
                    if (ctx){
                        // Draw rectangle
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 2;
                        ctx.strokeRect(left, top, right - left, bottom - top);

                        ctx.font = '50px Arial';
                        // Draw label
                        ctx.fillStyle = color;
                        ctx.fillRect((left + right) / 2 + 10, (top + bottom) / 2 + 10, 80, 80);
                        ctx.fillStyle = darkMode ? 'rgba(255, 250, 250, 0.5)' : 'rgba(10, 10, 10, 0.5)';
                        ctx.fillText(label, (left + right) / 2 + 15, (top + bottom) / 2 + 60);
                    }
                }

            } catch (e) {
                console.error("ERROR: An exception occurs while labeling the image\n", e);
            }
        });
        
    }
    const capturexml = useCallback(async () => {
        if (!GLOBAL_STATE.adb) {
            return;
        }

        try {
            // Get the XML
            const prefix = "ui_dump";
            const saveDir = "/path/to/save/xml";
            const xmltext = await getXmlViaSocket(GLOBAL_STATE.adb, prefix, saveDir);
            // Parse the XML string
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmltext, "application/xml");

            // Do something with the XML document
            console.log(xmlDoc);
            
            const clickable_list: AndroidElement[] = [];
            const focusable_list: AndroidElement[] = [];
            traverseTree(xmlDoc, clickable_list, 'clickable', true);
            traverseTree(xmlDoc, focusable_list, 'focusable', true);


            const elemList: AndroidElement[] = [...clickable_list];

            focusable_list.forEach(elem => {
                const bbox = elem.bbox;
                const center: [number, number] = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                let close = false;

                for (const e of clickable_list) {
                    const bbox = e.bbox;
                    const center_: [number, number] = [(bbox[0][0] + bbox[1][0]) / 2, (bbox[0][1] + bbox[1][1]) / 2];
                    const dist = Math.sqrt(Math.pow(center[0] - center_[0], 2) + Math.pow(center[1] - center_[1], 2));

                    if (dist <= configs.MIN_DIST) {
                        close = true;
                        break;
                    }
                }

                if (!close) {
                    elemList.push(elem);
                }
            });
           
            setElements(elemList);
            drawBboxMulti( elemList,   false,   false)
            
        } catch (e: any) {
            GLOBAL_STATE.showErrorDialog(e);
        }
    }, []);


    useEffect(() => {
        return autorun(() => {
            const canvas = canvasRef.current;
            if (canvas && state.imageData) {
                canvas.width = state.width;
                canvas.height = state.height;
                const context = canvas.getContext("2d")!;
                context.putImageData(state.imageData, 0, 0);
            }
        });
    }, []);

    const commandBarItems = computed(() => [
        {
            key: "start",
            disabled: !GLOBAL_STATE.adb,
            iconProps: {
                iconName: Icons.Camera,
                style: { height: 20, fontSize: 20, lineHeight: 1.5 },
            },
            text: "截图",
            onClick: capture,
        },
        {
            key: "xml",
            disabled: !GLOBAL_STATE.adb,
            iconProps: {
                iconName: Icons.Camera,
                style: { height: 20, fontSize: 20, lineHeight: 1.5 },
            },
            text: "xml",
            onClick: capturexml,
        },
        {
            key: "replay",
            disabled: !GLOBAL_STATE.adb,
            iconProps: {
                iconName: Icons.ArrowClockwise,
                style: { height: 20, fontSize: 20, lineHeight: 1.5 },
            },
            text: "回放",
            onClick: replayAction,
        },
        {
            key: "Save",
            disabled: !state.imageData,
            iconProps: {
                iconName: Icons.Save,
                style: { height: 20, fontSize: 20, lineHeight: 1.5 },
            },
            text: "保存",
            onClick: () => {
                const canvas = canvasRef.current;
                if (!canvas) {
                    return;
                }

                const url = canvas.toDataURL();
                const a = document.createElement("a");
                a.href = url;
                a.download = `Screenshot of ${GLOBAL_STATE.device!.name}.png`;
                a.click();
            },
        },
    ]);
    const [newItemName, setNewItemName] = useState("");

    const selection = useConst(
        () =>
            new Selection({
                onSelectionChanged() {
                    runInAction(() => {
                        state.selectedItems =
                            selection.getSelection() as RecordedAction[];
                    });
                },
            })
    );

    // const handleAddItem = () => {
    //     if (newItemName.trim() !== "") {
    //         state.addItem(newItemName);
    //         setNewItemName("");
    //     }
    // };

    const handleClearItems = () => {
        state.clearItems();
    };

    const handleDeleteSelectedItems = () => {
        state.deleteSelectedItems();
    };

    return (
        // <div style={{ padding: 2, overflow: "hidden auto",position: 'relative', ...style }}>
            
        //     <Stack horizontal >
        //         <Stack >
        //             <CommandBar
        //                 items={commandBarItems.get()}
        //             />
        //             <Stack horizontal grow styles={{ root: { height: 0 } }}>
        //             <DeviceView width={state.width} height={state.height} >
        //                 <canvas ref={canvasRef} style={{ display: "block" }} />
        //             </DeviceView>
        //             </Stack>
        //         </Stack>
        //         {/* <Stack tokens={{ childrenGap: 8 }}>
                    
        //             <TextField
        //                 label="对话："
        //                 value={newItemName}
        //                 onChange={(e, newValue) => setNewItemName(newValue || "")}
        //             />
        //             <Stack horizontal tokens={{ childrenGap: 8 }}>
        //                 <PrimaryButton text="Add Item" onClick={handleAddItem} />
        //                 <DefaultButton text="Clear Items" onClick={handleClearItems} />
        //                 <DefaultButton
        //                     text="Delete Selected"
        //                     onClick={handleDeleteSelectedItems}
        //                     disabled={state.selectedItems.length === 0}
        //                 />
        //             </Stack>
        //             <StackItem grow>
        //                 <MarqueeSelection selection={selection}>
        //                     <ShimmeredDetailsList
        //                         items={state.items}
        //                         selection={selection}
        //                         columns={[
        //                             {
        //                                 key: "name",
        //                                 name: "Name",
        //                                 fieldName: "name",
        //                                 minWidth: 100,
        //                                 isResizable: true,
        //                             },
        //                         ]}
        //                         setKey="set"
        //                     />
        //                 </MarqueeSelection>
        //             </StackItem>
        //         </Stack> */}
        //     </Stack>
        // </div>
        <Stack  {...RouteStackProps  } style={{ padding: 0 }}>

            
            <Stack horizontal grow styles={{ root: { height: 0 } }}>

                <DeviceView width={state.width} height={state.height}>
                    <canvas ref={canvasRef} style={{ display: "block" }} />
                </DeviceView>
                
                <Stack tokens={{ childrenGap: 8 }} style={{ padding: 2, width: 400 }}>
                    <CommandBar
                        items={commandBarItems.get()}
                    />
                    <TextField
                        label="对话："
                        value={newItemName}
                        onChange={(e, newValue) => setNewItemName(newValue || "")}
                    />
                    <Stack horizontal tokens={{ childrenGap: 8 }}>
                        {/* <PrimaryButton text="Add Item" onClick={handleAddItem} /> */}
                        <DefaultButton text="Clear Items" onClick={handleClearItems} />
                        <DefaultButton
                            text="Delete Selected"
                            onClick={handleDeleteSelectedItems}
                            disabled={state.selectedItems.length === 0}
                        />
                    </Stack>
                    <StackItem grow>
                        <MarqueeSelection selection={selection}>
                            <ShimmeredDetailsList
                                items={STATE.recordedActions}
                                selection={selection}
                                columns={[
                                    {
                                        key: "name",
                                        name: "Type",
                                        fieldName: "type",
                                        minWidth: 100,
                                        isResizable: true,
                                    },
                                ]}
                                setKey="set"
                            />
                        </MarqueeSelection>
                    </StackItem>
                    
                    {/* <div>
                        {elements.map((element, index) => (
                            <div key={index}>
                                ID: {element.id}, BBox: {JSON.stringify(element.bbox)}, Attrib: {element.attrib}
                            </div>
                        ))}
                    </div> */}
   
                </Stack> 
            </Stack>
        </Stack>
    );
});
