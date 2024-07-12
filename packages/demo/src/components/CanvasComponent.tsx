import React, { useEffect, useRef } from 'react';
import { autorun, runInAction } from "mobx";
import { CommandBar, DemoModePanel, DeviceView } from "../components";

interface CanvasProps {
    state: any;
}

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

const CanvasComponent: React.FC<CanvasProps> = ({ state }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const mouseisdown = useRef<boolean>(false);


    function drawBboxMulti(elemList: AndroidElement[], recordMode = false, darkMode = false): void {
        elemList?.forEach((elem, index) => {
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
                    if (ctx) {
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
                console.log("ERROR: An exception occurs while labeling the image\n" + e);
            }
        });

    }

    const drawCoordinates = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const context = canvas.getContext('2d');
            if (context) {
                const coordX1 = state.coordX1;
                const coordY1 = state.coordY1;
                const coordX2 = state.coordX2;
                const coordY2 = state.coordY2;
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

    const drawImage = () => {
        const canvas = canvasRef.current;
        const imageData = state.imageData;
        if (canvas && imageData) {
            canvas.width = state.capwidth;
            canvas.height = state.capheight;
            const context = canvas.getContext("2d")!;
            context.putImageData(imageData, 0, 0);
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const handleCanvasMousedown = (event: MouseEvent) => {
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                const x = state.capwidth * (event.clientX - rect.left) / rect.width;
                const y = state.capheight * (event.clientY - rect.top) / rect.height;
                runInAction(() => {
                    state.coordX1 = `${x.toFixed(0)}`;
                    state.coordY1 = `${y.toFixed(0)}`;
                });
            }
            mouseisdown.current = true;
        };
        const handleCanvasMouseup = (event: MouseEvent) => {
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                const x = state.capwidth * (event.clientX - rect.left) / rect.width;
                const y = state.capheight * (event.clientY - rect.top) / rect.height;
                runInAction(() => {
                    state.coordX2 = `${x.toFixed(0)}`;
                    state.coordY2 = `${y.toFixed(0)}`;
                });
            }
            mouseisdown.current = false;
        };
        const handleCanvasMousemove = (event: MouseEvent) => {
            if (canvas && mouseisdown.current) {
                const rect = canvas.getBoundingClientRect();
                const x = state.capwidth * (event.clientX - rect.left) / rect.width;
                const y = state.capheight * (event.clientY - rect.top) / rect.height;
                runInAction(() => {
                    state.coordX2 = `${x.toFixed(0)}`;
                    state.coordY2 = `${y.toFixed(0)}`;
                });
            }
        };
        if (canvas) {
            canvas.addEventListener("mousedown", handleCanvasMousedown);
            canvas.addEventListener("mouseup", handleCanvasMouseup);
            canvas.addEventListener("mousemove", handleCanvasMousemove);
        }

        return autorun(() => {
            drawImage();
            drawCoordinates();
            drawBboxMulti(state.elements);
        });
    }, []);

    useEffect(() => {
        drawImage();
        drawCoordinates();
        drawBboxMulti(state.elements);
    }, [state.imageData, state.capwidth, state.capheight]);

    return (

        <canvas ref={canvasRef} style={{ display: "block" }} />


    );
};

export default CanvasComponent;
