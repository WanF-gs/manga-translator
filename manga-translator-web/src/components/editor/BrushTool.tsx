'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Slider, message, Tooltip } from 'antd';
import {
  Brush,
  Undo2,
  Redo2,
  Eraser,
  RotateCcw,
  Circle,
  X,
} from 'lucide-react';
import clsx from 'clsx';

interface BrushStroke {
  id: string;
  points: { x: number; y: number }[];
  size: number;
  color: string;
  type: 'brush' | 'eraser';
}

interface BrushToolProps {
  /** 图片容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 图片自然尺寸 */
  imageWidth: number;
  imageHeight: number;
  /** 关闭回调 */
  onClose: () => void;
  /** 保存回调 */
  onSave?: (strokes: BrushStroke[]) => void;
}

const COLORS = ['#FFFFFF', '#F0F0F0', '#E0E0E0', '#D0D0D0', '#C0C0C0', '#000000'];

/** 手动修补笔刷组件 */
export const BrushTool: React.FC<BrushToolProps> = ({
  containerRef,
  imageWidth,
  imageHeight,
  onClose,
  onSave,
}) => {
  const [brushSize, setBrushSize] = useState(20);
  const [brushColor, setBrushColor] = useState('#FFFFFF');
  const [brushType, setBrushType] = useState<'brush' | 'eraser'>('brush');
  const [strokes, setStrokes] = useState<BrushStroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<BrushStroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState<BrushStroke[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 画布重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const allStrokes = currentStroke ? [...strokes, currentStroke] : strokes;

    allStrokes.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.type === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    });
  }, [strokes, currentStroke]);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      return {
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
      };
    },
    []
  );

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const pos = getCanvasPos(e);
      const newStroke: BrushStroke = {
        id: `stroke_${Date.now()}`,
        points: [pos],
        size: brushSize,
        color: brushColor,
        type: brushType,
      };
      setCurrentStroke(newStroke);
      setIsDrawing(true);
    },
    [brushSize, brushColor, brushType, getCanvasPos]
  );

  const continueDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || !currentStroke) return;
      e.preventDefault();
      const pos = getCanvasPos(e);
      setCurrentStroke({
        ...currentStroke,
        points: [...currentStroke.points, pos],
      });
    },
    [isDrawing, currentStroke, getCanvasPos]
  );

  const endDrawing = useCallback(() => {
    if (!currentStroke) return;
    setStrokes((prev) => [...prev, currentStroke]);
    setCurrentStroke(null);
    setIsDrawing(false);
    setUndoStack([]);
  }, [currentStroke]);

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    const lastStroke = strokes[strokes.length - 1];
    setStrokes((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, lastStroke]);
  }, [strokes]);

  const handleRedo = useCallback(() => {
    if (undoStack.length === 0) return;
    const lastUndone = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setStrokes((prev) => [...prev, lastUndone]);
  }, [undoStack]);

  const handleClear = useCallback(() => {
    setStrokes([]);
    setCurrentStroke(null);
    setUndoStack([]);
  }, []);

  const handleSave = useCallback(() => {
    onSave?.(strokes);
    message.success('修补已保存');
    onClose();
  }, [strokes, onSave, onClose]);

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 flex-wrap">
        {/* 笔刷/橡皮切换 */}
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          <button
            onClick={() => setBrushType('brush')}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              brushType === 'brush'
                ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-500'
                : 'text-slate-400'
            )}
          >
            <Brush size={16} />
          </button>
          <button
            onClick={() => setBrushType('eraser')}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              brushType === 'eraser'
                ? 'bg-white dark:bg-slate-700 shadow-sm text-red-500'
                : 'text-slate-400'
            )}
          >
            <Eraser size={16} />
          </button>
        </div>

        {/* 笔刷大小 */}
        <div className="flex items-center gap-2">
          <Circle size={14} className="text-slate-400" />
          <Slider
            min={1}
            max={100}
            value={brushSize}
            onChange={setBrushSize}
            style={{ width: 100 }}
            tooltip={{ formatter: (v) => `${v}px` }}
          />
          <span className="text-xs text-slate-400 w-8 tabular-nums">{brushSize}px</span>
        </div>

        {/* 颜色选择 */}
        {brushType === 'brush' && (
          <div className="flex items-center gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setBrushColor(color)}
                className={clsx(
                  'w-5 h-5 rounded-full border-2 transition-all',
                  brushColor === color
                    ? 'border-primary-500 scale-110'
                    : 'border-slate-200 dark:border-slate-600'
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

        {/* 撤销/重做 */}
        <Tooltip title="撤销">
          <button
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
          >
            <Undo2 size={16} />
          </button>
        </Tooltip>
        <Tooltip title="重做">
          <button
            onClick={handleRedo}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
          >
            <Redo2 size={16} />
          </button>
        </Tooltip>
        <Tooltip title="清除全部">
          <button
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 disabled:opacity-30 transition-colors"
          >
            <RotateCcw size={16} />
          </button>
        </Tooltip>

        <div className="flex-1" />

        {/* 操作按钮 */}
        <Button size="small" onClick={onClose} icon={<X size={14} />}>
          取消
        </Button>
        <Button size="small" type="primary" onClick={handleSave}>
          保存修补
        </Button>
      </div>

      {/* 笔刷画布 */}
      <div
        ref={overlayRef}
        className="flex-1 relative overflow-hidden bg-slate-100 dark:bg-slate-950 cursor-crosshair"
        onMouseDown={startDrawing}
        onMouseMove={continueDrawing}
        onMouseUp={endDrawing}
        onMouseLeave={endDrawing}
        onTouchStart={startDrawing}
        onTouchMove={continueDrawing}
        onTouchEnd={endDrawing}
      >
        <canvas
          ref={canvasRef}
          width={imageWidth}
          height={imageHeight}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
        {/* 光标预览 */}
        <div
          className="absolute pointer-events-none rounded-full border-2 border-primary-500/50"
          style={{
            width: brushSize,
            height: brushSize,
            transform: 'translate(-50%, -50%)',
            backgroundColor: brushType === 'eraser' ? 'rgba(239,68,68,0.1)' : `${brushColor}50`,
          }}
        />
      </div>
    </div>
  );
};
