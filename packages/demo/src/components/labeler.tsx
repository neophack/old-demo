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

class LabelerPanelState {
   
    contextMenuTarget: MouseEvent | undefined = undefined;
    imageData: ImageData | undefined = undefined;
    width = 0;
    height = 0;
    thought = "";
    elements: AndroidElement[] = [];
    xmltexts=""
    task=""
    observation=""
    
    coordX1="";
    coordY1="";
    coordX2="";
    coordY2="";
    inputText="";
    commandType="";

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





// Define ADB command types
type AdbCommandType = 'tap' | 'text' | 'swipe' | 'keyevent' | 'start';

// Function to execute ADB command
async function executeAdbCommand(command: string) {
    try {
        if (!GLOBAL_STATE.adb) {
            throw new Error('ADB instance not available.');
        }
        
        let stdout = await GLOBAL_STATE.adb.subprocess.spawnAndWaitLegacy(command.split(" "));

        let responseStr = stdout.trim();
        console.log(responseStr)

        // Optionally handle success scenario
        // console.log(`ADB command executed successfully: ${command}`);
    } catch (error: any) {
        // Handle error scenario
        console.error('Error executing ADB command:', error);
        GLOBAL_STATE.showErrorDialog(error);
    }
}

// Define adb command mappings
const adbCommands: Record<AdbCommandType, (params: any) => void> = {
    
    'tap': ({ x, y }: { x: number; y: number }) => {
        const command = `input tap ${ x} ${ y}`;
        // const command = ` rm /data/local/tmp/yadb`;
        executeAdbCommand(command);
    },
    'text': ({ text }: { text: string }) => {
        // const command = `input text "${text}"`;
        // const command = `ime set com.android.adbkeyboard/.AdbIME`;
        // const command = `am broadcast -a ADB_INPUT_TEXT --es msg "${text}"`;
        const command = `app_process -Djava.class.path=/data/local/tmp/yadb /data/local/tmp com.ysbing.yadb.Main -keyboard "${text}"`;
        executeAdbCommand(command);
    },
    'swipe': ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => {
        const command = `input swipe ${ x1} ${ y1} ${ x2} ${ y2} 200`;
        executeAdbCommand(command);
    },
    'keyevent': ({ keycode }: { keycode: number }) => {
        const command = `input keyevent ${keycode}`;
        executeAdbCommand(command);
    },
    'start': () => {
        const command = 'am start -a android.intent.action.MAIN -c android.intent.category.HOME';
        executeAdbCommand(command);
    },
};

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

function traverseTreeAndExtractText(xmlDoc: Document, elemList: AndroidElement[], addIndex: boolean = false): void {
    const xpathResult = xmlDoc.evaluate('//*[@*]', xmlDoc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

    for (let i = 0; i < xpathResult.snapshotLength; i++) {
        const node = xpathResult.snapshotItem(i) as Element;
        const text = node.getAttribute('text');
        
        // Skip elements with empty or null text
        if (!text) continue;

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

        elemList.push(new AndroidElement(elemId, [[x1, y1], [x2, y2]], text));
        
    }
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
    // const dumpCommand = `uiautomator dump /sdcard/${prefix}.xml`;
    const dumpCommand = `app_process -Djava.class.path=/data/local/tmp/yadb /data/local/tmp com.ysbing.yadb.Main -layout`;
   
    try {
        
        let stdout = await adb.subprocess.spawnAndWaitLegacy(dumpCommand.split(" "));

        let responseStr = stdout.trim();
        console.log(responseStr)
        
        if (!responseStr.includes(`layout dumped to:/data/local/tmp/yadb_layout_dump.xml`)) {
            throw new AdbXmlFetchError("Failed to dump UI hierarchy.");
        }
        // if (!responseStr.includes(`UI hierchary dumped to: /sdcard/${prefix}.xml`)) {
        //     throw new AdbXmlFetchError("Failed to dump UI hierarchy.");
        // }
        
    } catch (error) {
        if (error instanceof Error) {
            throw new AdbXmlFetchError(error.message);
        } else {
            throw new AdbXmlFetchError("An unknown error occurred.");
        }
    }
    const sync = await adb!.sync();
    
    try {
        // const readable = await sync.read(`/sdcard/${prefix}.xml`);
        const readable = await sync.read(`/data/local/tmp/yadb_layout_dump.xml`);
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
    const mouseisdown = useRef<boolean>(false);

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
            switch(state.commandType){
                case "tap":
                    handleAdbCommand('tap', { x: state.coordX1, y: state.coordY1 });
                    break;
                case "text":
                    handleAdbCommand('text', { text: state.inputText });
                    break;
                case "swipe":
                    handleAdbCommand('swipe', { x1: state.coordX1, y1: state.coordY1, x2: state.coordX2, y2: state.coordY2 }); // Replace with actual coordinates
                    break;
                case "keyevent":
                    const keyCode = 4; // Replace with desired key code
                    handleAdbCommand('keyevent', { keycode: keyCode });
                    break;
                case "start":
                    handleAdbCommand('start', {});
                    break;
            }
        

            
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
            const text_list: AndroidElement[] = [];
            
            traverseTree(xmlDoc, clickable_list, 'clickable', true);
            traverseTree(xmlDoc, focusable_list, 'focusable', true);
            traverseTreeAndExtractText(xmlDoc, text_list, true);
            

            let all_text = 'view文字:\n'; // Clear previous content

            text_list.forEach(elem => {
                const x1 = elem.bbox[0][0];
                const y1 = elem.bbox[0][1];
                const x2 = elem.bbox[1][0];
                const y2 = elem.bbox[1][1];
            
                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;
                const w = x2 - x1;
                const h = y2 - y1;
            
                const bboxStr = `(${cx.toFixed(0)},${cy.toFixed(0)}) [${w.toFixed(0)},${h.toFixed(0)}]`;
                all_text += `${bboxStr}:${elem.attrib}\n`;
            });
            
            all_text += "view按钮:\n";
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
            elemList.forEach(elem => {
                const x1 = elem.bbox[0][0];
                const y1 = elem.bbox[0][1];
                const x2 = elem.bbox[1][0];
                const y2 = elem.bbox[1][1];
            
                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;
                const w = x2 - x1;
                const h = y2 - y1;
            
                const bboxStr = `(${cx.toFixed(0)},${cy.toFixed(0)}) [${w.toFixed(0)},${h.toFixed(0)}]`;
                all_text += `${bboxStr}:${elem.id}:${elem.attrib}\n`;
            });
            runInAction(() => {
            state.xmltexts=all_text;
            state.elements=elemList;
            });
            drawBboxMulti( elemList,   false,   false)
            
        } catch (e: any) {
            GLOBAL_STATE.showErrorDialog(e);
        }
    }, []);


    useEffect(() => {
        const canvas = canvasRef.current;
        const handleCanvasMousedown = (event: MouseEvent) => {
            if(canvas){
                const rect = canvas.getBoundingClientRect();
                const x = state.width*(event.clientX - rect.left)/rect.width;
                const y = state.height*(event.clientY - rect.top)/rect.height;
                runInAction(() => {
                state.coordX1 = `${x.toFixed(0)}`;
                state.coordY1 = `${y.toFixed(0)}`;
                });
            }
            mouseisdown.current=true;
        };
        const handleCanvasMouseup = (event: MouseEvent) => {
            if(canvas){
                const rect = canvas.getBoundingClientRect();
                const x = state.width*(event.clientX - rect.left)/rect.width;
                const y = state.height*(event.clientY - rect.top)/rect.height;
                runInAction(() => {
                state.coordX2 = `${x.toFixed(0)}`;
                state.coordY2 = `${y.toFixed(0)}`;
                });
            }
            mouseisdown.current=false;
        };
        const handleCanvasMousemove = (event: MouseEvent) => {
            if(canvas && mouseisdown.current){
                const rect = canvas.getBoundingClientRect();
                const x = state.width*(event.clientX - rect.left)/rect.width;
                const y = state.height*(event.clientY - rect.top)/rect.height;
                runInAction(() => {
                state.coordX2 = `${x.toFixed(0)}`;
                state.coordY2 = `${y.toFixed(0)}`;
                });
            }
        };
        if(canvas){
            canvas.addEventListener("mousedown", handleCanvasMousedown);
            canvas.addEventListener("mouseup", handleCanvasMouseup);
            canvas.addEventListener("mousemove", handleCanvasMousemove);
        }
        
        return autorun(() => {
            
            const canvas = canvasRef.current;
            if (canvas && state.imageData) {
                canvas.width = state.width;
                canvas.height = state.height;
                const context = canvas.getContext("2d")!;
                context.putImageData(state.imageData, 0, 0);
            }
            drawCoordinates();
        });
    }, []);

    const drawCoordinates = () => {
        const canvas = canvasRef.current;
        if(canvas){
            const context = canvas.getContext('2d');
            if(context){
            // context.clearRect(0, 0, canvas.width, canvas.height);
    
            const { coordX1, coordY1, coordX2, coordY2 } = state;
                if (coordX1 && coordY1 && coordX2 && coordY2) {
                    const icoordX1 = parseInt(coordX1);
                    const icoordY1 = parseInt(coordY1);
                    const icoordX2 = parseInt(coordX2);
                    const icoordY2 = parseInt(coordY2);
                    // Draw first point in red
                    context.fillStyle = 'red';
                    context.beginPath();
                    context.arc(icoordX1, icoordY1, 20, 0, 2 * Math.PI);
                    context.fill();
        
                    // Draw second point in blue
                    context.fillStyle = 'blue';
                    context.beginPath();
                    context.arc(icoordX2, icoordY2, 20, 0, 2 * Math.PI);
                    context.fill();
        
                    // Draw line connecting points in green
                    context.strokeStyle = 'green';
                    context.lineWidth = 10;
                    context.beginPath();
                    context.moveTo(icoordX1, icoordY1);
                    context.lineTo(icoordX2, icoordY2);
                    context.stroke();
                }
            }
        }
        
    };

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




    // Function to handle ADB command execution
    const handleAdbCommand = useCallback((commandType: AdbCommandType, params: any) => {
        if (adbCommands.hasOwnProperty(commandType)) {
            adbCommands[commandType](params);
            runInAction(() => {
            state.commandType = commandType;
            });
        } else {
            console.error(`Unknown ADB command type: ${commandType}`);
        }
    }, []);

    // Example button handler for tapping
    const handleTap = useCallback(() => {
        handleAdbCommand('tap', { x: state.coordX1, y: state.coordY1 }); // Replace with actual coordinates
    }, [handleAdbCommand]);

    // Example button handler for typing text
    const handleTypeText = useCallback(() => {
        // const textToType = 'Hello, World!';
        handleAdbCommand('text', { text: state.inputText });
    }, [handleAdbCommand]);

    // Example button handler for swiping
    const handleSwipe = useCallback(() => {
        handleAdbCommand('swipe', { x1: state.coordX1, y1: state.coordY1, x2: state.coordX2, y2: state.coordY2 }); // Replace with actual coordinates
    }, [handleAdbCommand]);

    // Example button handler for key event
    const handleKeyEvent = useCallback(() => {
        const keyCode = 4; // Replace with desired key code
        handleAdbCommand('keyevent', { keycode: keyCode });
    }, [handleAdbCommand]);

    // Example button handler for starting main activity
    const handleStartMainActivity = useCallback(() => {
        handleAdbCommand('start', {});
    }, [handleAdbCommand]);

    const handleCoordChange = (event: any, newValue?: string) => {
        // 正则表达式验证输入是否为整数
        const regex = /^[0-9]*$/;
        if (newValue === undefined || regex.test(newValue)) {
            return newValue ?? '';
        }
        return "";
    };

    return (
     
        <Stack  {...RouteStackProps  } style={{ padding: 0 }}>

            
            <Stack horizontal grow styles={{ root: { height: 0 } }}>

                <DeviceView width={state.width} height={state.height}>
                    <canvas ref={canvasRef} style={{ display: "block" }} />
                </DeviceView>
                
                <Stack tokens={{ childrenGap: 2 }} style={{ padding: 2 }}>
                    <CommandBar
                        items={commandBarItems.get()}
                    />
                     <TextField
                        label="界面文字:"
                        multiline
                        rows={6} // Adjust rows as needed
                        value={state.xmltexts}
                        onChange={(e, newValue) => state.xmltexts = newValue || ""}
                    />
                    <TextField
                        label="任务："
                        multiline
                        rows={2}
                        value={state.task}
                        onChange={(e, newValue) => state.task = newValue || ""}
                    />
                    <Stack horizontal tokens={{ childrenGap: 2 }} style={{flexDirection: 'row', justifyContent: 'space-between' }}>
                        <TextField
                            label="观察："
                            multiline
                            rows={3}
                            styles={{ root: { flex: 1 } }}
                            value={state.observation}
                            onChange={(e, newValue) => state.observation = newValue || ""}
                        />
                        <TextField
                            label="思考："
                            multiline
                            rows={3}
                            styles={{ root: { flex: 1 } }}
                            value={state.thought}
                            onChange={(e, newValue) => state.thought =newValue || ""}
                        />
                    </Stack>
                    <Stack horizontal tokens={{ childrenGap: 2 }}>
                        <DefaultButton text="点击" onClick={handleTap} />
                        <DefaultButton text="滑动" onClick={handleSwipe} />
                        <DefaultButton text="输入" onClick={handleTypeText} />

                        <DefaultButton text="返回" onClick={handleKeyEvent} />
                        <DefaultButton text="Home" onClick={handleStartMainActivity} />
                    </Stack>
                    <TextField
                        label="操作"
                        name="操作"
                        value={state.commandType}
                        disabled
                        // onChange={(e, newValue) => state.inputText = newValue || ""}
                    />
                    <Stack horizontal tokens={{ childrenGap: 2 }}>
                        <TextField
                            label="X1"
                            name="coordX1"
                            value={state.coordX1}
                            onChange={(e, newValue) => state.coordX1 = handleCoordChange(e, newValue)}
                            styles={{ root: { width: 100 } }}
                        />
                        <TextField
                            label="Y1"
                            name="coordY1"
                            value={state.coordY1}
                            onChange={(e, newValue) => state.coordY1 = handleCoordChange(e, newValue)}
                            styles={{ root: { width: 100 } }}
                        />
                        <TextField
                            label="X2"
                            name="coordX2"
                            value={state.coordX2}
                            onChange={(e, newValue) => state.coordX2 = handleCoordChange(e, newValue)}
                            styles={{ root: { width: 100 } }}
                        />
                        <TextField
                            label="Y2"
                            name="coordY2"
                            value={state.coordY2}
                            onChange={(e, newValue) => state.coordY2 = handleCoordChange(e, newValue)}
                            styles={{ root: { width: 100 } }}
                        />
                    </Stack>
                    <TextField
                        label="输入"
                        name="输入"
                        value={state.inputText}
                        onChange={(e, newValue) => runInAction(() => {state.inputText = newValue || ""})}
                    />
                    
                </Stack> 
            </Stack>
        </Stack>
    );
});
