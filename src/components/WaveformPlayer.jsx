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

export default function WaveformPlayer({ audioUrl, fileName, textColor = "#000000", customColor, showFileName = true, peaks }) {
  const containerRef = useRef(null);
  const wavesurferRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [volume, setVolume] = useState(1);

  const resolvedColor = customColor || (textColor === "#ffffff" ? "#ffffff" : "#000000");

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

    if (audioUrl) {
      wavesurferRef.current.load(audioUrl);
    }

    if (durationData) {
      setDuration(formatTime(durationData));
    }

    wavesurferRef.current.on('ready', () => {
      setDuration(formatTime(wavesurferRef.current.getDuration()));
    });

    wavesurferRef.current.on('audioprocess', () => {
      setCurrentTime(formatTime(wavesurferRef.current.getCurrentTime()));
    });

    wavesurferRef.current.on('seek', () => {
      setCurrentTime(formatTime(wavesurferRef.current.getCurrentTime()));
    });

    wavesurferRef.current.on('play', () => {
      setIsPlaying(true);
    });

    wavesurferRef.current.on('pause', () => {
      setIsPlaying(false);
    });

    wavesurferRef.current.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(formatTime(0));
    });

    return () => {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
    };
  }, [audioUrl, resolvedColor, peaks]);

  const togglePlay = (e) => {
    e.stopPropagation();
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
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(newVol);
    }
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
          width: 12px;
          height: 16px;
          background: linear-gradient(90deg, #ffffff 0%, #dddddd 30%, #444444 45%, #444444 55%, #dddddd 70%, #ffffff 100%);
          border: 1px solid var(--slider-color, currentColor);
          border-radius: 1px;
          margin-top: -5px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .retro-volume-slider::-moz-range-track {
          background: transparent;
          border: none;
          height: 6px;
        }
        .retro-volume-slider::-moz-range-thumb {
          width: 12px;
          height: 16px;
          background: linear-gradient(90deg, #ffffff 0%, #dddddd 30%, #444444 45%, #444444 55%, #dddddd 70%, #ffffff 100%);
          border: 1px solid var(--slider-color, currentColor);
          border-radius: 1px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
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
          width: '130px'
        }}
      >
        <span style={{ fontSize: '9px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '2px', fontWeight: 'bold' }}>vol</span>
        <span className="retro-slider-label" style={{ fontSize: '9px', opacity: 0.8, fontFamily: 'monospace', minWidth: '6px' }}>0</span>
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
        <span className="retro-slider-label" style={{ fontSize: '9px', opacity: 0.8, fontFamily: 'monospace', minWidth: '6px' }}>1</span>
      </div>
    </div>
  );
}
