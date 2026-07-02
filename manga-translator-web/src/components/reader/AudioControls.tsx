'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Slider, Space, Tooltip, App, Progress } from 'antd';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Gauge, Subtitles, Download, Loader2
} from 'lucide-react';
import { audioApi } from '@/services/audio';

export interface ReaderTextBlock {
  region_id: string;
  original_text: string;
  translated_text: string;
  voice_id?: string;
  bbox_hash?: string;
}

export interface AudioControlsProps {
  textBlocks: ReaderTextBlock[];
  currentBlockIndex: number;
  onBlockChange?: (index: number) => void;
  voiceId?: string;
  variant?: 'dark' | 'light';
  compact?: boolean;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  textBlocks,
  currentBlockIndex,
  onBlockChange,
  voiceId = 'ja-female-01',
  variant = 'dark',
  compact = false,
}) => {
  const { message } = App.useApp();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlock = textBlocks[currentBlockIndex];

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playCurrentBlock = useCallback(async () => {
    if (!activeBlock) return;

    const text = activeBlock.translated_text || activeBlock.original_text || '';
    if (!text.trim()) {
      message.warning('当前文本为空');
      return;
    }

    setLoading(true);
    try {
      const res = await audioApi.generate({
        page_id: text.slice(0, 32),
        voice_id: voiceId,
        text,
      });
      const data = res.data?.data;
      if (data?.audio_url) {
        setAudioUrl(data.audio_url);
        const audio = new Audio(data.audio_url);
        audio.playbackRate = speed;
        audio.onloadedmetadata = () => setDuration(audio.duration);
        audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
        audio.onended = () => {
          setPlaying(false);
          // Auto-advance to next block
          if (currentBlockIndex < textBlocks.length - 1 && onBlockChange) {
            setTimeout(() => onBlockChange(currentBlockIndex + 1), 500);
          }
        };
        audio.onerror = () => {
          message.error('音频播放失败');
          setPlaying(false);
        };
        await audio.play();
        audioRef.current = audio;
        setPlaying(true);

        // Highlight the block on the page
        onBlockChange?.(currentBlockIndex);
      }
    } catch (err: any) {
      message.error(err.message || 'TTS合成失败');
    } finally {
      setLoading(false);
    }
  }, [activeBlock, voiceId, speed, currentBlockIndex, textBlocks.length, onBlockChange, message]);

  const pauseAudio = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    setAudioUrl(null);
    setCurrentTime(0);
  }, []);

  const skipNext = useCallback(() => {
    stopAudio();
    if (currentBlockIndex < textBlocks.length - 1 && onBlockChange) {
      onBlockChange(currentBlockIndex + 1);
    }
  }, [currentBlockIndex, textBlocks.length, onBlockChange, stopAudio]);

  const skipPrev = useCallback(() => {
    stopAudio();
    if (currentBlockIndex > 0 && onBlockChange) {
      onBlockChange(currentBlockIndex - 1);
    }
  }, [currentBlockIndex, onBlockChange, stopAudio]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const btnClass = 'p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors';

  return (
    <div className={`flex flex-col gap-2 ${compact ? 'p-1' : 'p-2'}`}>
      {/* Progress bar */}
      {playing && duration > 0 && (
        <div className="w-full">
          <Progress
            percent={progress}
            showInfo={false}
            strokeColor="#3b82f6"
            trailColor="rgba(255,255,255,0.1)"
            size="small"
          />
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between gap-1">
        <Space size={4}>
          <Tooltip title="上一句">
            <button className={btnClass} onClick={skipPrev} disabled={currentBlockIndex === 0}>
              <SkipBack size={16} />
            </button>
          </Tooltip>

          <Tooltip title={playing ? '暂停' : '播放'}>
            <button
              className={`p-2 rounded-full ${playing ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
              onClick={playing ? pauseAudio : playCurrentBlock}
              disabled={loading}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> :
               playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
          </Tooltip>

          <Tooltip title="下一句">
            <button className={btnClass} onClick={skipNext} disabled={currentBlockIndex >= textBlocks.length - 1}>
              <SkipForward size={16} />
            </button>
          </Tooltip>
        </Space>

        {!compact && (
          <Space size={4}>
            <Tooltip title={`语速 ${speed}x`}>
              <button className={btnClass} onClick={() => setSpeed(s => Math.min(2, +(s + 0.25).toFixed(2)))} disabled={speed >= 2}>
                <Gauge size={14} />
                <span className="text-[10px] ml-0.5">{speed}x</span>
              </button>
            </Tooltip>

            <Tooltip title={showSubtitles ? '隐藏字幕' : '显示字幕'}>
              <button
                className={`p-1.5 rounded-lg hover:bg-white/10 transition-colors ${showSubtitles ? 'text-blue-400' : 'text-slate-500'}`}
                onClick={() => setShowSubtitles(!showSubtitles)}
              >
                <Subtitles size={14} />
              </button>
            </Tooltip>

            {audioUrl && (
              <Tooltip title="下载音频">
                <a href={audioUrl} download className={btnClass}>
                  <Download size={14} />
                </a>
              </Tooltip>
            )}
          </Space>
        )}
      </div>

      {/* Block indicator */}
      {!compact && activeBlock && (
        <div className="text-center">
          <span className="text-xs text-slate-400">
            {currentBlockIndex + 1} / {textBlocks.length}
          </span>
          {showSubtitles && (
            <p className="text-[11px] text-slate-300 mt-0.5 line-clamp-1 italic">
              "{activeBlock.original_text}"
            </p>
          )}
        </div>
      )}
    </div>
  );
};
