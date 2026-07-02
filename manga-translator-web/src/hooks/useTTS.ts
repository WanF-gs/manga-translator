'use client';

/**
 * TTS 语音朗读 Hook
 * 封装浏览器 Speech Synthesis API
 */
import { useState, useCallback, useRef, useEffect } from 'react';

interface UseTTSOptions {
  /** 默认语言 */
  defaultLang?: string;
  /** 默认语速 (0.1-10) */
  defaultRate?: number;
  /** 默认音调 (0-2) */
  defaultPitch?: number;
}

export function useTTS(options?: UseTTSOptions) {
  const { defaultLang = 'zh-CN', defaultRate = 0.9, defaultPitch = 1 } = options || {};
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(defaultRate);
  const [pitch, setPitch] = useState(defaultPitch);
  const [lang, setLang] = useState(defaultLang);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // 清理
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  /** 朗读文本 */
  const speak = useCallback(
    (text: string, speakLang?: string) => {
      if (!text) return;

      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speakLang || lang;
      utterance.rate = rate;
      utterance.pitch = pitch;

      utterance.onstart = () => setIsPlaying(true);
      utterance.onend = () => setIsPlaying(false);
      utterance.onerror = () => setIsPlaying(false);

      utteranceRef.current = utterance;
      window.speechSynthesis?.speak(utterance);
    },
    [lang, rate, pitch]
  );

  /** 暂停 */
  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setIsPlaying(false);
  }, []);

  /** 恢复 */
  const resume = useCallback(() => {
    window.speechSynthesis?.resume();
    setIsPlaying(true);
  }, []);

  /** 停止 */
  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
  }, []);

  /** 逐句播放（按分隔符拆分） */
  const speakSentences = useCallback(
    (text: string, speakLang?: string, separator = '。') => {
      stop();
      const sentences = text
        .split(separator)
        .map((s) => s.trim())
        .filter(Boolean);

      if (sentences.length === 0) return;

      let index = 0;
      const speakNext = () => {
        if (index >= sentences.length) {
          setIsPlaying(false);
          return;
        }
        const utterance = new SpeechSynthesisUtterance(sentences[index]);
        utterance.lang = speakLang || lang;
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.onstart = () => setIsPlaying(true);
        utterance.onend = () => {
          index++;
          speakNext();
        };
        utterance.onerror = () => {
          index++;
          speakNext();
        };
        utteranceRef.current = utterance;
        window.speechSynthesis?.speak(utterance);
      };
      speakNext();
    },
    [stop, lang, rate, pitch]
  );

  return {
    isPlaying,
    rate,
    pitch,
    lang,
    setRate,
    setPitch,
    setLang,
    speak,
    pause,
    resume,
    stop,
    speakSentences,
  };
}
