import axios from 'axios';
import React, { useState, useEffect, useCallback } from 'react';
import {
    Breadcrumb,
    ContextualMenu,
    ContextualMenuItem,
    DetailsListLayoutMode,
    Dialog,
    DirectionalHint,
    IBreadcrumbItem,
    IColumn,
    IContextualMenuItem,
    IDetailsHeaderProps,
    IRenderFunction,
    Icon,
    Layer,
    MarqueeSelection,
    Overlay,
    ProgressIndicator,
    Selection,
    ShimmeredDetailsList,
    Stack,
    StackItem,
    concatStyleSets,
    mergeStyleSets,
} from "@fluentui/react";
import { SelectionMode } from '@fluentui/react/lib/Utilities'; // 根据你的具体UI库导入路径可能有所不同
import {
    Icons,
    ProgressStream,
    RouteStackProps,
    asyncEffect,
    createFileStream,
    formatSize,
    formatSpeed,
    pickFile,
    saveFile,
} from "../utils";
import { NextPage } from "next";
import Head from "next/head";
import { CommandBar, NoSsr } from "../components";
import {
    action,
    autorun,
    makeAutoObservable,
    observable,
    runInAction,
} from "mobx";
import { useConst } from "@fluentui/react-hooks";
import { STATE } from "../components/scrcpy/state";
import { observer } from "mobx-react-lite";

const API_URL = 'http://127.0.0.1:8080/api/files';

interface FileItem {
    name: string;
    // Add other properties if needed
}

export const getFiles = async () => {
    try {
        const response = await axios.get(API_URL);
        return response.data;
    } catch (error) {
        console.error('Error fetching files:', error);
        throw error;
    }
};

export const readFile = async (fileName: string) => {
    try {
        const response = await axios.get(`${API_URL}/${fileName}`);
        return response.data;
    } catch (error) {
        console.error(`Error reading file ${fileName}:`, error);
        throw error;
    }
};

export const readBlob = async (fileName: string) => {
    try {
        const response = await axios.get(`${API_URL}/${fileName}`, { responseType: 'blob' });
        return response.data;
    } catch (error) {
        console.error(`Error reading file ${fileName}:`, error);
        throw error;
    }
};

export const imageUrl = async (fileName: string) => {
    return `${API_URL}/${fileName}`;

};

export const uploadFile = async (file: File) => {
    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await axios.post(API_URL, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error uploading file:', error);
        throw error;
    }
};

export const deleteFile = async (fileName: string) => {
    try {
        const response = await axios.delete(`${API_URL}/${fileName}`);
        return response.data;
    } catch (error) {
        console.error(`Error deleting file ${fileName}:`, error);
        throw error;
    }
};
export async function refreshImages(items: string[], loading: boolean) {
    loading = true;
    try {
        const filesList = await getFiles(); // Assuming getFiles() is defined elsewhere
        console.log(filesList);
        runInAction(() => {
            if (filesList.length > 0) {
                const filteredItems = filesList.filter((file: string) =>
                    file.match(/\.(jpeg|jpg|png|gif)$/i)
                );
                items.splice(0, items.length, ...filteredItems);
            } else {
                items.splice(0, items.length); // Clear items if filesList is empty
            }
            loading = false;
        });
    } catch (error) {
        console.error('Error refreshing files:', error);
        loading = false;
    }
}

export const previousFile = async (currentFile: string) => {
    let items: string[] = [];
    let loading = true;
    await refreshImages(items, loading);

    let currentIndex = 1;
    if (currentFile != "") {
        currentIndex = items.findIndex((item) => item === currentFile);
    }

    if (currentIndex > 0) {
        runInAction(() => {
            STATE.currentFile = items[currentIndex - 1];
        });
    }
};

export const nextFile = async (currentFile: string) => {
    let items: string[] = [];
    let loading = true;
    await refreshImages(items, loading);
    let currentIndex = items.length - 2;
    if (currentFile != "") {
        currentIndex = items.findIndex((item) => item === currentFile);
    }
    if (currentIndex < items.length - 1) {
        runInAction(() => {
            STATE.currentFile = items[currentIndex + 1];
        });
    }
};




const renderDetailsHeader: IRenderFunction<IDetailsHeaderProps> = (
    props?,
    defaultRender?,
) => {
    if (!props || !defaultRender) {
        return null;
    }

    return defaultRender({
        ...props,
        styles: concatStyleSets(props.styles, { root: { paddingTop: 0 } }),
    });
};

class FileServiceState {
    loading = false;
    items: string[] = [];
    sortDescending = false;
    uploading = false;
    uploadPath: string | undefined = undefined;
    uploadedSize = 0;
    uploadTotalSize = 0;
    debouncedUploadedSize = 0;
    uploadSpeed = 0;
    selectedItems: FileItem[] = [];
    // contextMenuTarget: MouseEvent | undefined = undefined;

    constructor() {
        makeAutoObservable(this);
        // makeAutoObservable(this, {
        //     items: observable.shallow,
        // });
    }


    get menuItems() {
        let result: IContextualMenuItem[] = [];
        result.push(
            {
                key: "refresh",
                text: "刷新",
                iconProps: {
                    iconName: Icons.ArrowClockwise,
                    style: { height: 20, fontSize: 20, lineHeight: 1.5 },
                },
                disabled: false,
                onClick: () => {
                    refreshImages(this.items, this.loading);
                    return false;
                },
            },
            {
                key: "delete",
                text: "删除",
                // disabled: this.selectedItems.length == 0,
                iconProps: {
                    iconName: Icons.Delete,
                    style: {
                        height: 20,
                        fontSize: 20,
                        lineHeight: 1.5,
                    },
                },
                onClick: () => {
                    this.selectedItems.forEach(async (item) => {
                        // 获取文件名和没有后缀的文件名
                        const fileName = item.name;  // 原始文件名，包括后缀
                        const baseName = fileName.split('.').slice(0, -1).join('.'); // 没有后缀的文件名

                        // 删除原始文件
                        await deleteFile(fileName);

                        // 删除对应的 JSON 文件
                        await deleteFile(`${baseName}.json`);
                    });
                    runInAction(() => {
                        this.selectedItems = [];
                        setTimeout(() => {
                            refreshImages(this.items, this.loading);
                        }, 1000); // 1 second delay (adjust as needed)
                    });
                    return false;
                },
            },
        );
        return result;
    }
}

const state = new FileServiceState();

export const refreshFiles = async () => {
    refreshImages(state.items, state.loading);
}

export const FileService = observer(() => {
    //   const [files, setFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        refreshImages(state.items, state.loading);
    }, []);


    // const hideContextMenu = useCallback(() => {
    //     runInAction(() => (state.contextMenuTarget = undefined));
    // }, []);

    const selection = useConst(
        () =>
            new Selection({
                selectionMode: SelectionMode.single, // 设置为单选模式
                onSelectionChanged() {
                    runInAction(() => {
                        state.selectedItems = selection.getSelection() as FileItem[];
                        state.selectedItems.forEach((item) => {
                            STATE.currentFile = item.name;
                        });
                    });

                },
            }),
    );

    // const showContextMenu = useCallback(
    //     (item?: string, index?: number, e?: Event) => {
    //         if (!e) {
    //             return false;
    //         }

    //         if (state.menuItems.length) {
    //             runInAction(() => {
    //                 state.contextMenuTarget = e as MouseEvent;
    //             });
    //         }

    //         return false;
    //     },
    //     [],
    // );

    const columns: IColumn[] = [
        {
            key: 'name',
            name: 'File Name',
            fieldName: 'name',
            minWidth: 100,
            isResizable: true,
            // isSorted: true,
            // isSortedDescending: state.sortDescending,
        },
    ];

    return (
        <Stack {...RouteStackProps} style={{ padding: 0 }}>
            <CommandBar items={state.menuItems} />

            <StackItem
                grow
                styles={{
                    root: {
                        margin: "0px",
                        padding: "0px",
                        overflowY: "auto",
                    },
                }}
            >
                <MarqueeSelection selection={selection} >
                    <ShimmeredDetailsList
                        items={(state.items || []).map(name => ({ name }))}
                        columns={columns}
                        selection={selection}
                        layoutMode={DetailsListLayoutMode.justified}
                        enableShimmer={state.loading}
                        // onItemContextMenu={showContextMenu}
                        // onRenderDetailsHeader={renderDetailsHeader}
                        usePageCache
                        useReducedRowRenderer
                    />
                </MarqueeSelection>
            </StackItem>
            {error && (
                <Dialog
                    hidden={false}
                    onDismiss={() => setError(null)}
                    dialogContentProps={{
                        title: 'Error',
                        subText: error,
                    }}
                />
            )}
        </Stack>
    );
});
