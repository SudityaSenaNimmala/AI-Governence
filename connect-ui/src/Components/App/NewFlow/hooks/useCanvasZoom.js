import { useRef, useState } from "react";
import { zoomToFit } from "../../../helpers/utils";

export const useCanvasZoom = (containerRef) => {
    const [scale, setScale] = useState(1);
    const innerRef = useRef(null);
    const position = useRef({ x: 0, y: 0 });
    const dragStart = useRef({ x: 0, y: 0 });
    const isDragging = useRef(false);

    const updateTransform = (newScale = scale) => {
        if (innerRef.current) {
            innerRef.current.style.transform = `translate(${position.current.x}px, ${position.current.y}px) scale(${newScale})`;
        }
    };

    const onWheelZoom = (e) => {
        const zoomIntensity = 0.001;
        const next = Math.min(Math.max(scale - e.deltaY * zoomIntensity, 0.3), 2);
        setScale(next);
        updateTransform(next);
    };

    const onMouseDown = (e) => {
        isDragging.current = true;
        dragStart.current = {
            x: e.clientX - position.current.x,
            y: e.clientY - position.current.y,
        };
    };

    const onMouseMove = (e) => {
        if (!isDragging.current) return;

        position.current = {
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y,
        };

        requestAnimationFrame(() => {
            updateTransform();
        });
    };

    const stopDrag = () => {
        isDragging.current = false;
    };

    const resetZoom = () => {
        const { x, y, scale: newScale } = zoomToFit(containerRef, innerRef);
        position.current = { x, y };
        setScale(newScale);
        updateTransform(newScale);
    };

    const zoomIn = () => {
        const newScale = scale + 0.1;
        setScale(newScale);
        updateTransform(newScale);
    };

    const zoomOut = () => {
        const newScale = scale - 0.1;
        setScale(newScale);
        updateTransform(newScale);
    };

    return {
        scale,
        innerRef,
        position,
        isDragging,
        onWheelZoom,
        onMouseDown,
        onMouseMove,
        stopDrag,
        resetZoom,
        zoomIn,
        zoomOut,
    };
};

