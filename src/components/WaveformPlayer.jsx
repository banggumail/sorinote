import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

const getTranslucentColor = (hex, opacity = 0.3) => {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) {
    return hex;
  }
  let cleanHex = hex.slice(1);
  if (cleanHex.length === 3) {
    cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.slice(0, 2), 16);
    const g = parseInt(cleanHex.slice(2, 4), 16);
    const b = parseInt(cleanHex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return hex;
};

export default function WaveformPlayer({ memoId, audioUrl, fileName, textColor = "#000000", customColor, showFileName = true, peaks, onPlayStateChange }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [volume, setVolume] = useState(0.5);
  const gainNodeRef = useRef(null);
  const onPlayStateChangeRef = useRef(onPlayStateChange);

  const volumeRef = useRef(volume);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    onPlayStateChangeRef.current = onPlayStateChange;
  }, [onPlayStateChange]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const dispatchUpdate = () => {
    if (!memoId) return;
    if (!isPlayingRef.current) {
      dispatchStop();
      return;
    }
    const event = new CustomEvent(`audio-update-${memoId}`, {
      detail: { 
        currentTime: currentTimeRef.current, 
        duration: durationRef.current, 
        volume: volumeRef.current 
      }
    });
    window.dispatchEvent(event);
  };

  const dispatchStop = () => {
    if (!memoId) return;
    const event = new CustomEvent(`audio-stop-${memoId}`);
    window.dispatchEvent(event);
  };

  const resolvedColor = customColor || (textColor === "#ffffff" ? "#ffffff" : "#000000");

  const initWebAudioVolume = () => {
    if (gainNodeRef.current) return;
    if (!wavesurferRef.current) return;

    const mediaElement = wavesurferRef.current.getMediaElement();
    if (!mediaElement) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      if (!window.sharedAudioContext) {
        window.sharedAudioContext = new AudioContextClass();
      }
      const ctx = window.sharedAudioContext;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(err => console.warn('Context resume failed:', err));
      }

      let sourceNode = mediaElement.__webAudioSource;
      let gainNode = mediaElement.__webAudioGain;

      if (!sourceNode) {
        sourceNode = ctx.createMediaElementSource(mediaElement);
        gainNode = ctx.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        mediaElement.__webAudioSource = sourceNode;
        mediaElement.__webAudioGain = gainNode;
      }

      gainNodeRef.current = gainNode;
      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    } catch (err) {
      console.warn('Web Audio initialization failed:', err);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const durationData = peaks?.duration;

    const options = {
      container: containerRef.current,
      waveColor: resolvedColor,
      progressColor: getTranslucentColor(resolvedColor, 0.4),
      cursorColor: resolvedColor,
      cursorWidth: 1,
      height: 40,
    };

    wavesurferRef.current = WaveSurfer.create(options);
    wavesurferRef.current.setVolume(volume);

    if (audioUrl) {
      wavesurferRef.current.load(audioUrl);
    }

    if (durationData) {
      setDuration(formatTime(durationData));
    }

    wavesurferRef.current.on('ready', () => {
      const dur = formatTime(wavesurferRef.current.getDuration());
      setDuration(dur);
      durationRef.current = dur;
      dispatchUpdate();
    });

    wavesurferRef.current.on('audioprocess', () => {
      const time = formatTime(wavesurferRef.current.getCurrentTime());
      setCurrentTime(time);
      currentTimeRef.current = time;
      dispatchUpdate();
    });

    wavesurferRef.current.on('seek', () => {
      const time = formatTime(wavesurferRef.current.getCurrentTime());
      setCurrentTime(time);
      currentTimeRef.current = time;
      dispatchUpdate();
    });

    wavesurferRef.current.on('play', () => {
      isPlayingRef.current = true;
      setIsPlaying(true);
      if (onPlayStateChangeRef.current) {
        onPlayStateChangeRef.current(true);
      }
      const time = formatTime(wavesurferRef.current.getCurrentTime());
      const dur = formatTime(wavesurferRef.current.getDuration() || peaks?.duration || 0);
      currentTimeRef.current = time;
      durationRef.current = dur;
      dispatchUpdate();
    });

    wavesurferRef.current.on('pause', () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (onPlayStateChangeRef.current) {
        onPlayStateChangeRef.current(false);
      }
      dispatchStop();
    });

    wavesurferRef.current.on('finish', () => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      if (onPlayStateChangeRef.current) {
        onPlayStateChangeRef.current(false);
      }
      setCurrentTime(formatTime(0));
      currentTimeRef.current = '0:00';
      dispatchStop();
    });

    return () => {
      isPlayingRef.current = false;
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
      if (onPlayStateChangeRef.current) {
        onPlayStateChangeRef.current(false);
      }
      dispatchStop();
    };
  }, [audioUrl, resolvedColor, peaks]);

  const togglePlay = (e) => {
    e.stopPropagation();
    initWebAudioVolume();
    if (window.sharedAudioContext && window.sharedAudioContext.state === 'suspended') {
      window.sharedAudioContext.resume().catch(err => console.warn('Context resume failed:', err));
    }
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause().catch(err => {
        console.error('Play/Pause failed:', err);
      });
    }
  };

  const handleVolumeChange = (e) => {
    e.stopPropagation();
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    volumeRef.current = newVol;
    initWebAudioVolume();
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(newVol);
    }
    if (gainNodeRef.current) {
      const ctx = window.sharedAudioContext;
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(err => console.warn('Context resume failed:', err));
        }
        gainNodeRef.current.gain.setValueAtTime(newVol, ctx.currentTime);
      }
    }
    dispatchUpdate();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: "transparent", padding: '0px', marginBottom: '0px', pointerEvents: 'auto' }}>
      <style>{`
        .retro-volume-slider {
          -webkit-appearance: none;
          appearance: none;
          flex: 1;
          height: 6px;
          background: repeating-linear-gradient(45deg, rgba(0,0,0,0.08), rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px);
          border: 1px solid var(--slider-color, currentColor);
          border-radius: 1px;
          outline: none;
          cursor: pointer;
          margin: 0;
          padding: 0;
          display: block;
        }
        .retro-volume-slider.dark-theme-slider {
          background: repeating-linear-gradient(45deg, rgba(255,255,255,0.08), rgba(255,255,255,0.08) 2px, rgba(255,255,255,0.18) 2px, rgba(255,255,255,0.18) 4px);
        }
        .retro-volume-slider::-webkit-slider-runnable-track {
          background: transparent;
          border: none;
          height: 6px;
        }
        .retro-volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 10px;
          height: 14px;
          background: #cccccc;
          border: 1px solid #ffffff;
          border-radius: 0px;
          margin-top: -4px;
        }
        .retro-volume-slider::-moz-range-track {
          background: transparent;
          border: none;
          height: 6px;
        }
        .retro-volume-slider::-moz-range-thumb {
          width: 10px;
          height: 14px;
          background: #cccccc;
          border: 1px solid #ffffff;
          border-radius: 0px;
          box-sizing: border-box;
        }
      `}</style>
      {showFileName && fileName && (
        <div style={{ fontSize: `${10}px`, color: textColor, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fileName}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button 
          type="button"
          onClick={togglePlay}
          disabled={!audioUrl}
          style={{ 
            background: audioUrl ? textColor : 'rgba(128,128,128,0.5)', color: textColor === "#ffffff" ? "#000" : "#fff", border: 'none', 
            borderRadius: '50%', width: '30px', height: '30px', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            cursor: 'pointer', flexShrink: 0, fontSize: '12px'
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div ref={containerRef} style={{ flex: 1, cursor: 'pointer', position: 'relative' }}>
          {!audioUrl && <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '1px', backgroundColor: resolvedColor, opacity: 0.3 }} />}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: `${9}px`, color: textColor === "#ffffff" ? "rgba(255,255,255,0.7)" : "#666", fontFamily: 'monospace' }}>
        <span>{currentTime}</span>
        <span>{duration}</span>
      </div>
      <div 
        className="retro-slider-container"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '5px', 
          marginTop: '4px', 
          padding: '0 4px',
          color: textColor,
          '--slider-color': textColor,
          width: '120px',
          alignSelf: 'flex-start'
        }}
      >
        <span style={{ fontSize: '9px', opacity: 0.8, letterSpacing: '0.5px', marginRight: '2px', fontWeight: 'bold' }}>*~</span>
        <span className="retro-slider-label" style={{ fontSize: '9px', opacity: 0.8, fontFamily: 'monospace', minWidth: '8px', fontWeight: 'bold' }}>0</span>
        <input 
          type="range" 
          min="0" max="1" step="0.01" 
          value={volume} 
          onChange={handleVolumeChange}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className={`retro-volume-slider ${textColor === '#ffffff' ? 'dark-theme-slider' : ''}`}
          title="볼륨 조절"
        />
        <span className="retro-slider-label" style={{ fontSize: '9px', opacity: 0.8, fontFamily: 'monospace', minWidth: '8px', fontWeight: 'bold' }}>1</span>
      </div>
    </div>
  );
}
