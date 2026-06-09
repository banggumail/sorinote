import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WaveformPlayer from '../components/WaveformPlayer';
import { io } from 'socket.io-client';
import { API_BASE, SOCKET_URL } from '../config';

const getContrastColor = (hexColor) => {
  if (!hexColor) return '#000000';
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#000000' : '#ffffff';
};

const isReddish = (hexColor) => {
  if (!hexColor || typeof hexColor !== 'string' || !hexColor.startsWith('#')) return false;
  const cleanHex = hexColor.slice(1);
  if (cleanHex.length !== 6 && cleanHex.length !== 3) return false;
  let r, g, b;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  }
  return r > g + 50 && r > b + 50;
};

const isWhiteOrVeryLight = (hexColor) => {
  if (!hexColor || typeof hexColor !== 'string' || !hexColor.startsWith('#')) return false;
  const cleanHex = hexColor.slice(1);
  if (cleanHex.length !== 6 && cleanHex.length !== 3) return false;
  let r, g, b;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  }
  return r > 240 && g > 240 && b > 240;
};

const getFormattedDate = () => {
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}.${now.getMonth() + 1}.${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

export default function Board() {
  const getComplementaryColor = (hex) => {
    if (!hex) return '#ffffff';
    if (hex.indexOf('#') === 0) hex = hex.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length !== 6) return '#ffffff';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const compR = (255 - r).toString(16).padStart(2, '0');
    const compG = (255 - g).toString(16).padStart(2, '0');
    const compB = (255 - b).toString(16).padStart(2, '0');
    return `#${compR}${compG}${compB}`;
  };

  const { padId } = useParams();
  const navigate = useNavigate();

  const CANVAS_SIZE = 5000; 
  const MINIMAP_SIZE = 300; 
  const scaleRate = MINIMAP_SIZE / CANVAS_SIZE; 

  const [worldExists, setWorldExists] = useState(true);
  const [padCreatedAt, setPadCreatedAt] = useState('');
  const [padTitle, setPadTitle] = useState(padId);
  const [padTitleColor, setPadTitleColor] = useState('');
  const [lastUsedUser, setLastUsedUser] = useState({ name: 'name', color: '#ffffff' });
  const [memos, setMemos] = useState([]);
  const [memoSizes, setMemoSizes] = useState({});

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    document.title = `sorinote_${padTitle}`;
  }, [padTitle]);

  const [lockedMemos, setLockedMemos] = useState({});
  const [cursors, setCursors] = useState({});
  const [deleteConfirmMemoId, setDeleteConfirmMemoId] = useState(null);
  const socketRef = useRef(null);
  const lastCursorEmit = useRef(0);

  const handleUserChange = (newUser) => {
    setLastUsedUser(newUser);
    setMemos(prev => prev.map(m => m.isEditing ? { ...m, author: newUser.name, color: newUser.color } : m));
    if (socketRef.current) {
      socketRef.current.emit('join-room', { padId, user: newUser });
    }
  };

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      setMemoSizes(prev => {
        const next = { ...prev };
        let changed = false;
        for (let entry of entries) {
          const id = entry.target.id.replace('memo-', '');
          const w = entry.target.offsetWidth;
          const h = entry.target.offsetHeight;
          if (!prev[id] || prev[id].w !== w || prev[id].h !== h) {
            next[id] = { w, h };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    
    memos.forEach(m => {
      const el = document.getElementById(`memo-${m.id}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [memos]);
      
  const [draggingMemo, setDraggingMemo] = useState(null);
  const [isDraggingMinimap, setIsDraggingMinimap] = useState(false); 

  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight - 60 }); 
  const scrollRef = useRef(null);
  const minimapRef = useRef(null); 

  const [highestZ, setHighestZ] = useState(100);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasBgColor, setCanvasBgColor] = useState('#FDFBF7');
  const [outerBgColor, setOuterBgColor] = useState('#E0E0D0');
  const [activeMemoId, setActiveMemoId] = useState(null);

  const minZoom = Math.min(Math.max(400, viewportSize.width - 40) / CANVAS_SIZE, Math.max(300, viewportSize.height - 180) / CANVAS_SIZE);
  const offsetX = Math.max(0, (viewportSize.width - CANVAS_SIZE * zoomLevel) / 2);
  const offsetY = Math.max(0, (viewportSize.height - CANVAS_SIZE * zoomLevel) / 2);
  const uiScale = Math.min(1, Math.max(0.71, viewportSize.width / 1920));

  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  const minZoomRef = useRef(minZoom);
  useEffect(() => {
    setZoomLevel(prev => {
      if (Math.abs(prev - minZoomRef.current) < 0.005) {
        return minZoom;
      }
      return Math.max(minZoom, prev);
    });
    minZoomRef.current = minZoom;
  }, [minZoom]);

  // Load Pad Data from API
  useEffect(() => {
    fetch(`${API_BASE}/api/pads/${padId}`)
      .then(res => {
        if (!res.ok) {
          throw new Error('Not Found');
        }
        return res.json();
      })
      .then(data => {
        const { pad, memos: loadedMemos } = data;
        setPadTitle(pad.title || padId);
        setPadCreatedAt(pad.date || '');
        if (pad.canvasBgColor) setCanvasBgColor(pad.canvasBgColor);
        if (pad.outerBgColor) setOuterBgColor(pad.outerBgColor);
        if (pad.titleColor) setPadTitleColor(pad.titleColor);
        
        const formatted = loadedMemos.map(m => ({
          ...m,
          isEditing: false,
          isExpanded: false
        }));
        setMemos(formatted);
        
        let maxZ = 100;
        loadedMemos.forEach(m => {
          if (m.z && m.z > maxZ) {
            maxZ = m.z;
          }
        });
        setHighestZ(maxZ);
        setWorldExists(true);
      })
      .catch(err => {
        console.error('Error fetching pad details:', err);
        setWorldExists(false);
      });
  }, [padId]);

  // Setup WebSockets
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.emit('join-room', { padId, user: lastUsedUser });

    socket.on('locks-sync', (locks) => {
      setLockedMemos(locks);
    });

    socket.on('memo:locked', ({ id, username }) => {
      setLockedMemos(prev => ({ ...prev, [id]: username }));
    });

    socket.on('memo:unlocked', ({ id }) => {
      setLockedMemos(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    socket.on('memo:moved', ({ id, x, y }) => {
      setMemos(prev => prev.map(m => m.id === id ? { ...m, x, y } : m));
    });

    socket.on('memo:published', (memo) => {
      setMemos(prev => {
        const idx = prev.findIndex(m => m.id === memo.id);
        if (idx !== -1) {
          return prev.map(m => m.id === memo.id ? { ...m, ...memo } : m);
        } else {
          return [...prev, memo];
        }
      });
      setLockedMemos(prev => {
        const next = { ...prev };
        delete next[memo.id];
        return next;
      });
    });

    socket.on('memo:deleted', ({ id }) => {
      setMemos(prev => prev.filter(m => m.id !== id));
      setLockedMemos(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (activeMemoId === id) setActiveMemoId(null);
    });

    socket.on('cursor:moved', ({ socketId, user, x, y }) => {
      setCursors(prev => ({ ...prev, [socketId]: { user, x, y } }));
    });

    socket.on('cursor:removed', ({ socketId }) => {
      setCursors(prev => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [padId]);

  const handleZoomChange = (newZoom, forceScrollUpdate = false) => {
    if (newZoom === zoomLevel && !forceScrollUpdate) return;
    if (!scrollRef.current) {
      setZoomLevel(newZoom);
      return;
    }

    let cx, cy;
    const activeMemo = activeMemoId ? memos.find(m => m.id === activeMemoId) : null;
    
    if (activeMemo) {
      const w = memoSizes[activeMemoId] ? memoSizes[activeMemoId].w : 340;
      const h = memoSizes[activeMemoId] ? memoSizes[activeMemoId].h : (activeMemo.isEditing ? 400 : (activeMemo.isExpanded ? 300 : 200));
      cx = activeMemo.x + w / 2;
      cy = activeMemo.y + h / 2;
    } else {
      cx = (scrollRef.current.scrollLeft + viewportSize.width / 2 - offsetX) / zoomLevel;
      cy = (scrollRef.current.scrollTop + viewportSize.height / 2 - offsetY) / zoomLevel;
    }

    const newOffsetX = Math.max(0, (viewportSize.width - CANVAS_SIZE * newZoom) / 2);
    const newOffsetY = Math.max(0, (viewportSize.height - CANVAS_SIZE * newZoom) / 2);

    const newScrollLeft = cx * newZoom + newOffsetX - viewportSize.width / 2;
    const newScrollTop = cy * newZoom + newOffsetY - viewportSize.height / 2;

    setZoomLevel(newZoom);
    
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = newScrollLeft;
        scrollRef.current.scrollTop = newScrollTop;
      }
    }, 10);
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      setScrollPos({ left: scrollRef.current.scrollLeft, top: scrollRef.current.scrollTop });
    }
  };

  const getWordPosition = (parentId, wordText) => {
    const el = document.querySelector(`span[data-p="${parentId}"][data-w="${wordText}"]`);
    if (el && scrollRef.current) {
      const r = el.getBoundingClientRect();
      const containerRect = scrollRef.current.getBoundingClientRect();
      return { 
        x: (r.left - containerRect.left + scrollRef.current.scrollLeft) / zoomLevel + (r.width / zoomLevel) / 2, 
        y: (r.top - containerRect.top + scrollRef.current.scrollTop) / zoomLevel + (r.height / zoomLevel) / 2 
      };
    }
    return null;
  };

  const handleBringToFront = (id) => {
    const nextZ = highestZ + 1;
    setHighestZ(nextZ);
    setMemos(prevMemos => prevMemos.map(m => m.id === id ? { ...m, z: nextZ } : m));
    setActiveMemoId(id);
  };

  const handleWriteNew = () => {
    // Check if there is already an editing memo
    const editingMemo = memos.find(m => m.isEditing);
    if (editingMemo) {
      if (!isMobile) {
        const nextZ = highestZ + 1;
        setHighestZ(nextZ);
        setMemos(prev => prev.map(m => m.id === editingMemo.id ? { ...m, z: nextZ } : m));
        setActiveMemoId(editingMemo.id);
        
        if (scrollRef.current) {
          const targetScrollLeft = (editingMemo.x + 170) * zoomLevel + offsetX - viewportSize.width / 2;
          const targetScrollTop = (editingMemo.y + 200) * zoomLevel + offsetY - viewportSize.height / 2;
          scrollRef.current.scrollLeft = targetScrollLeft;
          scrollRef.current.scrollTop = targetScrollTop;
        }
      }
      return;
    }

    const nextZ = highestZ + 1;
    setHighestZ(nextZ);
    let newX, newY;
    if (isMobile) {
      // Random position across the entire desktop canvas (with padding margin)
      newX = Math.random() * (CANVAS_SIZE - 350);
      newY = Math.random() * (CANVAS_SIZE - 350);
    } else {
      newX = (scrollPos.left - offsetX + viewportSize.width / 2) / zoomLevel - 170;
      newY = (scrollPos.top - offsetY + viewportSize.height / 2) / zoomLevel - 200;
    }
    const newId = Date.now(); 
    const newMemo = {
      id: newId, title: '', author: lastUsedUser.name, content: '', color: lastUsedUser.color, date: getFormattedDate(),
      x: newX, y: newY, isEditing: true, isExpanded: true,
      z: nextZ
    };
    setMemos([...memos, newMemo]);
    setActiveMemoId(newId);
    
    if (socketRef.current) {
      socketRef.current.emit('memo:edit-start', { padId, id: newId, username: lastUsedUser.name });
    }
  };

  const handleDeleteMemo = (id) => {
    if (deleteConfirmMemoId === id) {
      setMemos(prev => prev.filter(m => m.id !== id));
      if (activeMemoId === id) setActiveMemoId(null);
      setDeleteConfirmMemoId(null);
      
      if (socketRef.current) {
        socketRef.current.emit('memo:delete', { padId, id });
      }
    } else {
      setDeleteConfirmMemoId(id);
      setTimeout(() => {
        setDeleteConfirmMemoId(prev => prev === id ? null : prev);
      }, 3000);
    }
  };

  const handleEditMemo = (id) => {
    handleBringToFront(id);
    setMemos(prev => prev.map(m => m.id === id ? { ...m, isEditing: true, isExpanded: true } : m));
    
    if (socketRef.current) {
      socketRef.current.emit('memo:edit-start', { padId, id, username: lastUsedUser.name });
    }
  };

  const handlePublish = async (id, title, author, content, color, audioFile, imageFile) => {
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(-2)}.${now.getMonth() + 1}.${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setLastUsedUser({ name: author, color: color });
    
    let audioUrl = null;
    let audioFileName = null;
    let imageUrl = null;
    let imageFileName = null;
    
    const currentMemo = memos.find(m => m.id === id);
    if (currentMemo) {
      audioUrl = currentMemo.audioUrl;
      audioFileName = currentMemo.audioFileName;
      imageUrl = currentMemo.imageUrl;
      imageFileName = currentMemo.imageFileName;
    }
    
    if (audioFile) {
      const formData = new FormData();
      formData.append('file', audioFile);
      try {
        const res = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          body: formData
        });
        const uploadData = await res.json();
        audioUrl = uploadData.fileUrl;
        audioFileName = uploadData.originalName;
      } catch (err) {
        console.error('Audio upload failed:', err);
      }
    }
    
    if (imageFile) {
      const formData = new FormData();
      formData.append('file', imageFile);
      try {
        const res = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          body: formData
        });
        const uploadData = await res.json();
        imageUrl = uploadData.fileUrl;
        imageFileName = uploadData.originalName;
      } catch (err) {
        console.error('Image upload failed:', err);
      }
    }

    const updatedMemo = {
      ...currentMemo,
      title,
      author,
      content,
      color,
      date: dateStr,
      isEditing: false,
      isExpanded: false,
      audioUrl,
      audioFileName,
      imageUrl,
      imageFileName
    };
    
    setMemos(prev => prev.map(m => m.id === id ? updatedMemo : m));
    
    if (socketRef.current) {
      socketRef.current.emit('memo:publish', { padId, memo: updatedMemo });
    }
  };

  const updateScrollFromMinimap = (clientX, clientY) => {
    if (!minimapRef.current || !scrollRef.current) return;
    const rect = minimapRef.current.getBoundingClientRect();
    const clickX = (clientX - rect.left) / uiScale;
    const clickY = (clientY - rect.top) / uiScale;
    const targetCenterX = clickX / scaleRate;
    const targetCenterY = clickY / scaleRate;
    scrollRef.current.scrollLeft = targetCenterX * zoomLevel - viewportSize.width / 2;
    scrollRef.current.scrollTop = targetCenterY * zoomLevel - viewportSize.height / 2;
  };

  const handleMinimapPointerDown = (e) => {
    e.stopPropagation();
    setIsDraggingMinimap(true);
    updateScrollFromMinimap(e.clientX, e.clientY);
  };

  const getResolvedAudioUrl = (url) => {
    if (!url) return '';
    return url.startsWith('blob:') ? url : `${API_BASE}${url}`;
  };

  const getResolvedImageUrl = (url) => {
    if (!url) return '';
    return url.startsWith('blob:') ? url : `${API_BASE}${url}`;
  };

  const isWriting = memos.some(m => m.isEditing);

  const renderMobileBoard = () => {
    const sortedMemos = [...memos].filter(m => !m.isEditing).sort((a, b) => {
      return b.id - a.id;
    });

    const editingMemo = memos.find(m => m.isEditing);

    return (
      <div className="mobile-board-container" style={{ background: outerBgColor || '#E0E0D0' }}>
        <header className="mobile-board-header" style={{ backgroundColor: outerBgColor || '#E0E0D0', color: getContrastColor(outerBgColor || '#E0E0D0') }}>
          <div className="mobile-board-header-row" style={{ justifyContent: 'center' }}>
            <div className="mobile-board-title-group" style={{ flex: 1, textAlign: 'center', color: padTitleColor || 'inherit' }}>
              <span className="mobile-board-title">{padTitle}</span>
              {padCreatedAt && <span className="mobile-board-date" style={{ color: 'inherit', opacity: 0.7 }}>{padCreatedAt}</span>}
            </div>
          </div>
          <div className="mobile-board-header-row">
            <div className="mobile-author-picker-wrapper" style={{ border: `1px solid ${getContrastColor(outerBgColor || '#E0E0D0')}`, height: '30px', boxSizing: 'border-box' }}>
              <input 
                className="square-color-picker"
                type="color" 
                value={lastUsedUser.color} 
                onChange={(e) => handleUserChange({ ...lastUsedUser, color: e.target.value })} 
                style={{ width: '20px', height: '20px', flexShrink: 0 }}
                title="작성자 색상"
              />
              <input 
                type="text" 
                value={lastUsedUser.name} 
                onChange={(e) => handleUserChange({ ...lastUsedUser, name: e.target.value })} 
                onFocus={(e) => { if (e.target.value === 'name') handleUserChange({ ...lastUsedUser, name: '' }); }}
                placeholder="작성자 이름"
                className="mobile-author-input"
              />
            </div>
            <button 
              className={`mobile-write-btn ${isWriting ? 'active' : ''}`} 
              onClick={handleWriteNew}
              style={{
                background: getContrastColor(outerBgColor || '#E0E0D0'),
                color: outerBgColor || '#E0E0D0',
                border: `1px solid ${getContrastColor(outerBgColor || '#E0E0D0')}`,
                height: '30px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              쓰기
            </button>
          </div>
        </header>

        <div className="mobile-feed-container" style={{ backgroundColor: canvasBgColor || '#FDFBF7' }}>
          {/* 리소스 개수 카운트 표시 */}
          <div style={{
            alignSelf: 'center',
            backgroundColor: 'transparent',
            padding: '0px 12px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: getContrastColor(canvasBgColor || '#FDFBF7'),
            opacity: 0.8,
            display: 'flex',
            gap: '6px',
            whiteSpace: 'nowrap',
            width: 'fit-content',
            boxSizing: 'border-box',
            marginTop: '-6px',
            marginBottom: '4px'
          }}>
            <span>note {memoCount}</span>
            <span>·</span>
            <span>소리 {soundCount}</span>
            <span>·</span>
            <span>장면 {sceneCount}</span>
          </div>
          {sortedMemos.map(m => {
            const textColor = getContrastColor(m.color);
            const borderColor = textColor === "#ffffff" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
            const isLocked = lockedMemos[m.id] && lockedMemos[m.id] !== lastUsedUser.name;

            return (
              <div 
                id={`memo-${m.id}`}
                key={m.id}
                className="mobile-memo-card"
                style={{ '--memo-bg': m.color, backgroundColor: m.color, cursor: 'pointer' }}
                onClick={(e) => {
                  if (
                    e.target.tagName === 'BUTTON' || 
                    e.target.tagName === 'INPUT' || 
                    e.target.tagName === 'TEXTAREA' || 
                    e.target.closest('form') ||
                    e.target.closest('.mobile-memo-actions')
                  ) {
                    return;
                  }
                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isExpanded: !memo.isExpanded } : memo));
                }}
              >
                {/* 카드 헤더 */}
                <div className="mobile-memo-header">
                  <div className="mobile-memo-author-info">
                    {m.author && (
                      <span className="mobile-memo-author" style={{ color: m.titleColor || textColor }}>
                        {m.author} {isLocked && `(수정 중: ${lockedMemos[m.id]})`}
                      </span>
                    )}
                    <span className="mobile-memo-date" style={{ color: m.titleColor || textColor }}>
                      {m.date || getFormattedDate()}
                    </span>
                  </div>
                  <div>
                    {m.isEditing ? (
                      <button 
                        className="mobile-memo-toggle-btn"
                        onClick={() => {
                          if (m.title === '' && m.content === '') {
                            setMemos(memos.filter(memo => memo.id !== m.id));
                            if (activeMemoId === m.id) setActiveMemoId(null);
                            if (socketRef.current) {
                              socketRef.current.emit('memo:delete', { padId, id: m.id });
                            }
                          } else {
                            setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isEditing: false } : memo));
                            if (socketRef.current) {
                              socketRef.current.emit('memo:edit-end', { padId, id: m.id });
                            }
                          }
                        }}
                      >
                        X
                      </button>
                    ) : (
                      <button 
                        className="mobile-memo-toggle-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isExpanded: !memo.isExpanded } : memo));
                        }}
                      >
                        {m.isExpanded ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 카드 본문 / 수정 폼 */}
                <div className="mobile-memo-body">
                  {m.isEditing ? (
                    <form 
                      onSubmit={e => {
                        e.preventDefault();
                        handlePublish(m.id, e.target.t.value, m.author, e.target.c.value, m.color, e.target.audioFile.files[0], e.target.imageFile.files[0]);
                      }}
                      className="mobile-edit-form"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input 
                          name="t" 
                          placeholder="제목" 
                          defaultValue={m.title} 
                          required 
                          className="mobile-edit-input-title"
                          style={{ color: m.titleColor || textColor, borderBottomColor: borderColor }} 
                        />
                        <input 
                          className="square-color-picker"
                          type="color" 
                          style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                          value={m.titleColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                          onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, titleColor: e.target.value } : memo))}
                          title="제목 색상 변경"
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '10px' }}>
                        <div className="mobile-edit-file-row">
                          <label className="file-upload-label" style={{ 
                            color: textColor, 
                            flex: 1, 
                            border: `1px solid ${borderColor}`,
                            height: '32px',
                            boxSizing: 'border-box',
                            padding: '0 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.1)',
                            borderRadius: '0px',
                            fontSize: '14px',
                            cursor: 'pointer'
                          }}>
                            <span>소리</span>
                            <input name="audioFile" id={`audio-input-${m.id}`} type="file" accept="audio/*, .mp3, .wav, .m4a, .caf, .aac, .flac, .ogg, .webm, audio/mpeg, audio/mp3, audio/wav, audio/x-wav, audio/x-m4a, audio/m4a, audio/mp4, audio/caf, audio/x-caf" 
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: url, audioFileName: file.name } : memo));
                                }
                              }}
                              style={{ display: 'none' }} 
                            />
                          </label>
                        </div>

                        {m.audioUrl && (
                          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', color: textColor, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 'bold' }}>
                                {m.audioFileName}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: null, audioFileName: null } : memo));
                                  const input = document.getElementById(`audio-input-${m.id}`);
                                  if (input) input.value = '';
                                }}
                                className="file-upload-label"
                                style={{ 
                                  padding: '0 8px', 
                                  height: '24px', 
                                  color: textColor, 
                                  border: `1px solid ${borderColor}`,
                                  cursor: 'pointer',
                                  background: 'rgba(0,0,0,0.1)',
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                              >
                                삭제
                              </button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <WaveformPlayer audioUrl={getResolvedAudioUrl(m.audioUrl)} fileName={m.audioFileName || ''} textColor={textColor} customColor={m.waveformColor} showFileName={false} />
                              </div>
                              <input 
                                className="square-color-picker"
                                type="color" 
                                style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                                value={m.waveformColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                                onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, waveformColor: e.target.value } : memo))}
                                title="파장 색상 변경"
                              />
                            </div>
                          </div>
                        )}

                        <div className="mobile-edit-file-row">
                          <label className="file-upload-label" style={{ 
                            color: textColor, 
                            flex: 1, 
                            border: `1px solid ${borderColor}`,
                            height: '32px',
                            boxSizing: 'border-box',
                            padding: '0 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.1)',
                            borderRadius: '0px',
                            fontSize: '14px',
                            cursor: 'pointer'
                          }}>
                            <span>장면</span>
                            <input name="imageFile" id={`image-input-${m.id}`} type="file" accept="image/*" 
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: url, imageFileName: file.name } : memo));
                                }
                              }}
                              style={{ display: 'none' }} 
                            />
                          </label>
                        </div>

                        {m.imageUrl && (
                          <div className="mobile-memo-image-container" style={{ alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                              <span className="mobile-memo-image-name" style={{ color: textColor, flex: 1, fontWeight: 'bold' }}>{m.imageFileName}</span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: null, imageFileName: null } : memo));
                                  const input = document.getElementById(`image-input-${m.id}`);
                                  if (input) input.value = '';
                                }}
                                className="file-upload-label"
                                style={{ 
                                  padding: '0 8px', 
                                  height: '24px', 
                                  color: textColor, 
                                  border: `1px solid ${borderColor}`,
                                  cursor: 'pointer',
                                  background: 'rgba(0,0,0,0.1)',
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                              >
                                삭제
                              </button>
                            </div>
                            <img src={getResolvedImageUrl(m.imageUrl)} alt="Preview" className="mobile-memo-image" style={{ border: 'none', maxWidth: '100%', width: 'auto' }} />
                          </div>
                        )}
                      </div>

                      <textarea 
                        name="c" 
                        placeholder="내용..." 
                        defaultValue={m.content} 
                        required 
                        className="mobile-edit-textarea"
                        style={{ color: m.contentColor || textColor, borderColor: borderColor }} 
                      />

                      <div className="mobile-edit-footer">
                        <input 
                          className="square-color-picker"
                          type="color" 
                          style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                          value={m.contentColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                          onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, contentColor: e.target.value } : memo))}
                          title="내용 폰트 색상 변경"
                        />
                        <button type="submit" className="mobile-edit-submit-btn" style={{
                          color: textColor,
                          border: `1px solid ${borderColor}`,
                          height: '32px',
                          boxSizing: 'border-box',
                          padding: '0 20px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.1)',
                          borderRadius: '0px',
                          fontSize: '14px',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          boxShadow: 'none',
                          transform: 'none'
                        }}>
                          {(m.title === '' && m.content === '') ? '쓰기' : '완료'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="mobile-memo-title" style={{ color: m.titleColor || textColor }}>{m.title}</div>
                      
                      {m.audioUrl && (
                        <div style={{ margin: '4px 0' }} onClick={(e) => e.stopPropagation()}>
                          <WaveformPlayer audioUrl={getResolvedAudioUrl(m.audioUrl)} fileName={m.audioFileName || ''} textColor={textColor} customColor={m.waveformColor} />
                        </div>
                      )}

                      {m.imageUrl && (
                        <div className="mobile-memo-image-container">
                          <span className="mobile-memo-image-name" style={{ color: textColor }}>{m.imageFileName}</span>
                          <img src={getResolvedImageUrl(m.imageUrl)} alt="Uploaded" className="mobile-memo-image" style={{ border: 'none' }} />
                        </div>
                      )}

                      {m.isExpanded && m.content && (
                        <div className="mobile-memo-content" style={{ color: m.contentColor || textColor, paddingTop: '10px', marginTop: '4px' }}>
                          {m.content}
                        </div>
                      )}

                      {m.isExpanded && (
                        <div className="mobile-memo-actions" onClick={(e) => e.stopPropagation()}>
                          {isLocked ? (
                            <span style={{ fontSize: '12px', color: textColor, opacity: 0.8, fontStyle: 'italic' }}>
                              {lockedMemos[m.id]}님이 수정 중...
                            </span>
                          ) : (
                            <>
                              <button className="mobile-action-btn" onClick={() => handleEditMemo(m.id)} style={{ color: textColor }}>수정</button>
                              <button 
                                className={`mobile-action-btn ${deleteConfirmMemoId === m.id ? `mobile-delete-confirm-btn ${isReddish(m.color) ? 'red-bg-confirm' : ''}` : ''}`}
                                onClick={() => handleDeleteMemo(m.id)} 
                                style={{ color: deleteConfirmMemoId === m.id ? '#fff' : textColor }}
                              >
                                {deleteConfirmMemoId === m.id ? '확인' : '삭제'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {editingMemo && renderMobileEditingOverlay(editingMemo)}
      </div>
    );
  };

  const renderMobileEditingOverlay = (m) => {
    const textColor = getContrastColor(m.color);
    const borderColor = textColor === "#ffffff" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";

    return (
      <div 
        className="mobile-edit-backdrop"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          boxSizing: 'border-box'
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div 
          className="mobile-edit-modal-card"
          style={{
            backgroundColor: m.color,
            border: '1px solid #000000',
            boxShadow: '2px 2px 0px rgba(0,0,0,1)',
            transform: 'translate(-1px, -1px)',
            width: '100%',
            maxWidth: '450px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden'
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Top Header of Editing Overlay */}
          <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            borderBottom: `1px solid ${borderColor}`,
            color: textColor,
            flexShrink: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.18)'
          }}>
            <span style={{ fontSize: '11px', fontFamily: 'monospace', opacity: 0.8 }}>
              {m.date || getFormattedDate()}
            </span>
            <button 
              type="button"
              onClick={() => {
                if (m.title === '' && m.content === '') {
                  setMemos(memos.filter(memo => memo.id !== m.id));
                  if (activeMemoId === m.id) setActiveMemoId(null);
                  if (socketRef.current) {
                    socketRef.current.emit('memo:delete', { padId, id: m.id });
                  }
                } else {
                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isEditing: false } : memo));
                  if (socketRef.current) {
                    socketRef.current.emit('memo:edit-end', { padId, id: m.id });
                  }
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 'bold',
                padding: '4px 8px'
              }}
            >
              X
            </button>
          </header>

          {/* Form Body */}
          <form 
            onSubmit={e => {
              e.preventDefault();
              handlePublish(m.id, e.target.t.value, m.author, e.target.c.value, m.color, e.target.audioFile.files[0], e.target.imageFile.files[0]);
            }}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              padding: '16px',
              boxSizing: 'border-box',
              overflowY: 'auto',
              maxHeight: 'calc(90vh - 45px)',
              minHeight: 0
            }}
          >
            {/* Title Row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <input 
                name="t" 
                placeholder="제목을 입력하세요" 
                defaultValue={m.title} 
                required 
                style={{
                  flex: 1,
                  border: 'none',
                  borderBottom: `2px solid ${borderColor}`,
                  color: m.titleColor || textColor,
                  background: 'none',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  outline: 'none',
                  paddingBottom: '4px'
                }} 
              />
              <input 
                className="square-color-picker"
                type="color" 
                style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                value={m.titleColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, titleColor: e.target.value } : memo))}
                title="제목 색상 변경"
              />
            </div>

            {/* Files Row */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              {/* Audio Upload */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label className="file-upload-label" style={{ 
                  color: textColor, 
                  border: `1px solid ${borderColor}`, 
                  height: '32px', 
                  boxSizing: 'border-box',
                  fontSize: '14px', 
                  padding: '0 12px', 
                  width: 'fit-content', 
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.1)',
                  borderRadius: '0px',
                  cursor: 'pointer'
                }}>
                  <span>소리</span>
                  <input name="audioFile" id={`audio-input-${m.id}-modal`} type="file" accept="audio/*, .mp3, .wav, .m4a, .caf, .aac, .flac, .ogg, .webm, audio/mpeg, audio/mp3, audio/wav, audio/x-wav, audio/x-m4a, audio/m4a, audio/mp4, audio/caf, audio/x-caf" 
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: url, audioFileName: file.name } : memo));
                      }
                    }}
                    style={{ display: 'none' }} 
                  />
                </label>
              </div>

              {m.audioUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: textColor, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 'bold' }}>
                      {m.audioFileName}
                    </span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: null, audioFileName: null } : memo));
                        const input = document.getElementById(`audio-input-${m.id}-modal`);
                        if (input) input.value = '';
                      }}
                      className="file-upload-label"
                      style={{ 
                        padding: '0 8px', 
                        height: '24px', 
                        color: textColor, 
                        border: `1px solid ${borderColor}`,
                        cursor: 'pointer',
                        background: 'rgba(0,0,0,0.1)',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      삭제
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <WaveformPlayer audioUrl={getResolvedAudioUrl(m.audioUrl)} fileName={m.audioFileName || ''} textColor={textColor} customColor={m.waveformColor} showFileName={false} />
                    </div>
                    <input 
                      className="square-color-picker"
                      type="color" 
                      style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                      value={m.waveformColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                      onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, waveformColor: e.target.value } : memo))}
                      title="파장 색상 변경"
                    />
                  </div>
                </div>
              )}

              {/* Image Upload */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <label className="file-upload-label" style={{ 
                  color: textColor, 
                  border: `1px solid ${borderColor}`, 
                  height: '32px', 
                  boxSizing: 'border-box',
                  fontSize: '14px', 
                  padding: '0 12px', 
                  width: 'fit-content', 
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.1)',
                  borderRadius: '0px',
                  cursor: 'pointer'
                }}>
                  <span>장면</span>
                  <input name="imageFile" id={`image-input-${m.id}-modal`} type="file" accept="image/*" 
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        const url = URL.createObjectURL(file);
                        setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: url, imageFileName: file.name } : memo));
                      }
                    }}
                    style={{ display: 'none' }} 
                  />
                </label>
              </div>

              {m.imageUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: textColor, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 'bold' }}>{m.imageFileName}</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: null, imageFileName: null } : memo));
                        const input = document.getElementById(`image-input-${m.id}-modal`);
                        if (input) input.value = '';
                      }}
                      className="file-upload-label"
                      style={{ 
                        padding: '0 8px', 
                        height: '24px', 
                        color: textColor, 
                        border: `1px solid ${borderColor}`,
                        cursor: 'pointer',
                        background: 'rgba(0,0,0,0.1)',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}
                    >
                      삭제
                    </button>
                  </div>
                  <img src={getResolvedImageUrl(m.imageUrl)} alt="Preview" style={{ maxWidth: '100%', width: 'auto', maxHeight: '140px', objectFit: 'contain', border: 'none' }} />
                </div>
              )}
            </div>

            {/* Content Field */}
            <textarea 
              name="c" 
              placeholder="내용을 입력하세요..." 
              defaultValue={m.content} 
              required 
              style={{
                flex: 1,
                width: '100%',
                minHeight: '150px',
                backgroundColor: 'transparent',
                color: m.contentColor || textColor,
                border: `1px solid ${borderColor}`,
                fontSize: '15px',
                lineHeight: '1.5',
                padding: '10px',
                boxSizing: 'border-box',
                resize: 'none',
                outline: 'none'
              }} 
            />

            {/* Footer controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '4px',
              flexShrink: 0
            }}>
              <input 
                className="square-color-picker"
                type="color" 
                style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                value={m.contentColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, contentColor: e.target.value } : memo))}
                title="내용 폰트 색상 변경"
              />
              <button 
                type="submit" 
                className="file-upload-label"
                style={{
                  color: textColor,
                  border: `1px solid ${borderColor}`,
                  height: '32px',
                  boxSizing: 'border-box',
                  fontSize: '14px',
                  padding: '0 20px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.1)',
                  borderRadius: '0px'
                }}
              >
                완료
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const publishedMemos = memos.filter(m => !m.isEditing);
  const memoCount = publishedMemos.length;
  const soundCount = publishedMemos.filter(m => m.audioUrl).length;
  const sceneCount = publishedMemos.filter(m => m.imageUrl).length;

  if (isMobile) {
    return renderMobileBoard();
  }

  if (!worldExists) {
    return (
      <div style={{ padding: '10px', background: 'white', color: 'black', fontFamily: 'serif', height: '100vh' }}>
        <h1 style={{ fontSize: '2em', margin: '0.67em 0' }}>Not Found</h1>
        <p>The requested URL was not found on this server.</p>
        <hr style={{ border: 'none', borderTop: '1px solid #000', margin: '15px 0' }} />
        <p style={{ fontStyle: 'italic' }}>nginx/1.25.3</p>
      </div>
    );
  }

  return (
    <div className="board-container" style={{ display: 'flex', flexDirection: 'column', background: outerBgColor, width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', userSelect: 'none', '--comp-bg': getComplementaryColor(canvasBgColor), '--canvas-bg': canvasBgColor }}
      onPointerMove={e => {
        if (scrollRef.current) {
          const containerRect = scrollRef.current.getBoundingClientRect();
          const cursorX = (e.clientX - containerRect.left + scrollRef.current.scrollLeft - offsetX) / zoomLevel;
          const cursorY = (e.clientY - containerRect.top + scrollRef.current.scrollTop - offsetY) / zoomLevel;
          
          if (draggingMemo) {
            let newX = cursorX - draggingMemo.ox;
            let newY = cursorY - draggingMemo.oy;
            newX = Math.max(0, Math.min(newX, CANVAS_SIZE - 200));
            newY = Math.max(0, Math.min(newY, CANVAS_SIZE - 100));
            setMemos(memos.map(m => m.id === draggingMemo.id ? { ...m, x: newX, y: newY } : m));
            
            if (socketRef.current) {
              socketRef.current.emit('memo:move', { padId, id: draggingMemo.id, x: newX, y: newY });
            }
          }
          
          if (socketRef.current) {
            const now = Date.now();
            if (now - lastCursorEmit.current > 40) {
              socketRef.current.emit('cursor:move', { padId, user: lastUsedUser, x: cursorX, y: cursorY });
              lastCursorEmit.current = now;
            }
          }
        }
        if (isDraggingMinimap) {
          updateScrollFromMinimap(e.clientX, e.clientY);
        }
      }}
      onPointerUp={() => {
        setDraggingMemo(null);
        setIsDraggingMinimap(false);
      }}
      onPointerDown={() => setActiveMemoId(null)} 
    >
      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .title-wrapper {
          position: relative;
          width: 120px;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 8px;
          background-color: inherit;
        }
        .title-text {
          display: block;
          width: 100%;
          max-width: 120px;
          text-align: center;
          font-size: 20px;
          font-weight: bold;
          line-height: 1.25;
          word-break: keep-all;
          overflow-wrap: break-word;
          white-space: normal;
        }
      `}</style>

      {/* 좌측 상단: 원형 제목/날짜 패널 */}
      <div 
        onPointerDown={(e) => e.stopPropagation()} 
        onClick={() => handleZoomChange(minZoom)}
        className="info-circle"
        style={{ 
          transform: `scale(${uiScale})`, transformOrigin: 'top left', position: 'fixed', top: '20px', left: '20px', width: '150px', height: '150px',
          borderRadius: '50%', background: 'white', border: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, padding: '10px',
          textAlign: 'center', wordBreak: 'keep-all', overflowWrap: 'break-word', pointerEvents: 'auto', cursor: 'pointer'
      }}>
        <div className="title-wrapper">
          <strong 
            className="title-text"
            style={{ color: padTitleColor || 'inherit' }}
          >
            {padTitle}
          </strong>
        </div>
        <span style={{ fontSize: '13px', color: '#666', fontFamily: 'monospace' }}>{padCreatedAt}</span>
      </div>

      {/* 중앙 상단: 작성자 설정 및 리소스 카운트 통합 패널 */}
      <div onPointerDown={(e) => e.stopPropagation()} style={{ position: 'fixed', top: '20px', left: '50%', transform: `translateX(-50%) scale(${uiScale})`, transformOrigin: 'top center', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'white', padding: '10px 12px 8px 12px', border: 'none', width: '250px', boxSizing: 'border-box', gap: '8px' }}>
          {/* Row 1: 인풋 필드 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}>
            <input 
              className="square-color-picker"
              type="color" 
              value={lastUsedUser.color} 
              onChange={(e) => handleUserChange({ ...lastUsedUser, color: e.target.value })} 
              title="작성자 색상"
              style={{ width: '24px', height: '24px', flexShrink: 0 }}
            />
            <input 
              type="text" 
              value={lastUsedUser.name} 
              onChange={(e) => handleUserChange({ ...lastUsedUser, name: e.target.value })} 
              onFocus={(e) => { if (e.target.value === 'name') handleUserChange({ ...lastUsedUser, name: '' }); }}
              placeholder="작성자 이름"
              style={{ padding: '4px 8px', fontSize: '18px', fontWeight: 'normal', border: '1px solid #ccc', width: '160px', outline: 'none' }}
            />
          </div>

          {/* Row 2: 리소스 개수 카운트 표시 */}
          <div style={{ fontSize: '11px', color: '#666', fontFamily: 'monospace', display: 'flex', gap: '6px', whiteSpace: 'nowrap', width: '100%', justifyContent: 'center', borderTop: '1px solid #eee', paddingTop: '8px' }}>
            <span>note {memoCount}</span>
            <span>·</span>
            <span>소리 {soundCount}</span>
            <span>·</span>
            <span>장면 {sceneCount}</span>
          </div>
        </div>
      </div>

      {/* 우측 상단: 글쓰기 동그라미 버튼 */}
      <button onPointerDown={(e) => e.stopPropagation()} className={`write-btn ${isWriting ? 'active' : ''}`} onClick={handleWriteNew} style={{ transform: `scale(${uiScale})`, transformOrigin: 'top right', position: 'fixed', top: '20px', right: '20px', margin: 0, zIndex: 2000, pointerEvents: 'auto' }}>
        쓰기
      </button>

      {/* --- 선택된 메모 정보 표시 --- */}
      {activeMemoId && memos.find(m => m.id === activeMemoId) && (() => {
        const activeMemo = memos.find(m => m.id === activeMemoId);
        return (
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => handleZoomChange(1.5, true)}
            className="info-circle"
            style={{
            position: 'fixed', bottom: '20px', left: '20px',
            transform: `scale(${uiScale})`, transformOrigin: 'bottom left', 
            width: '150px', height: '150px', borderRadius: '50%',
            background: activeMemo.color || 'white', border: 'none', 
            zIndex: 3000, pointerEvents: 'auto', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', padding: '10px', wordBreak: 'keep-all', overflowWrap: 'break-word', gap: '6px',
            color: activeMemo.titleColor || getContrastColor(activeMemo.color || 'white')
          }}>
            <strong style={{ fontSize: '20px', color: 'inherit' }}>{activeMemo.title || (activeMemo.isEditing ? '(작성중...)' : '(제목 없음)')}</strong>
            <span style={{ fontSize: '16px', color: 'inherit', opacity: 0.8 }}>{activeMemo.author}</span>
          </div>
        );
      })()}

      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="hide-scrollbar" 
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        <div style={{ 
          width: Math.max(CANVAS_SIZE * zoomLevel, viewportSize.width), 
          height: Math.max(CANVAS_SIZE * zoomLevel, viewportSize.height),
          position: 'relative'
        }}>
          <div style={{
            position: 'absolute',
            left: offsetX,
            top: offsetY,
            width: CANVAS_SIZE * zoomLevel,
            height: CANVAS_SIZE * zoomLevel,
            overflow: 'hidden'
          }}>
            <main style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, position: 'relative', transform: `scale(${zoomLevel})`, transformOrigin: 'top left', backgroundColor: canvasBgColor }}>
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
            {memos.map(m => {
              const start = m.parentId && getWordPosition(m.parentId, m.sourceInfo.text);
              return start && <line key={m.id} x1={start.x} y1={start.y} x2={m.x} y2={m.y} stroke="#999" strokeWidth="1" />;
            })}
          </svg>

          {/* Cursors of other users */}
          {Object.entries(cursors).map(([socketId, cursor]) => {
            if (!cursor) return null;
            return (
              <div
                key={socketId}
                style={{
                  position: 'absolute',
                  left: cursor.x,
                  top: cursor.y,
                  pointerEvents: 'none',
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start'
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.5))' }}>
                  <path d="M4.5 3V17.5L9.2 13.5L14.2 21L17.5 19L12.5 11.5L18.5 11L4.5 3Z" fill={cursor.user.color || '#ff0000'} stroke="white" strokeWidth="1.5" />
                </svg>
                <span style={{
                  backgroundColor: cursor.user.color || '#ff0000',
                  color: getContrastColor(cursor.user.color || '#ff0000'),
                  fontSize: '11px',
                  fontWeight: 'bold',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  marginLeft: '8px',
                  marginTop: '-4px',
                  whiteSpace: 'nowrap',
                  boxShadow: '1px 1px 2px rgba(0,0,0,0.3)'
                }}>
                  {cursor.user.name || 'Anonymous'}
                </span>
              </div>
            );
          })}

          {memos.map(m => {
            const textColor = getContrastColor(m.color);
            const borderColor = textColor === "#ffffff" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
            const isLocked = lockedMemos[m.id] && lockedMemos[m.id] !== lastUsedUser.name;

            return (
            <div 
              id={`memo-${m.id}`}
              key={m.id} 
              onPointerDown={(e) => {
                e.stopPropagation(); 
                handleBringToFront(m.id);
              }}
              style={{ 
                position: 'absolute', left: m.x, top: m.y, border: '1px solid black', background: m.color, 
                
                width: '340px', 
                minWidth: '340px', 
                maxWidth: '340px', 
                
                height: m.isEditing ? 'auto' : (m.isExpanded ? undefined : 'auto'),
                minHeight: m.isEditing ? '400px' : (m.isExpanded ? '300px' : 'auto'),
                maxHeight: m.isExpanded ? '1000px' : 'max-content', 
                
                padding: '0', 
                zIndex: activeMemoId === m.id ? 9999 : (m.z || (m.isExpanded ? 100 : 1)), 
                boxShadow: '2px 2px 0px rgba(0,0,0,1)', display: 'flex', flexDirection: 'column',
                resize: 'none', 
                overflow: 'hidden'
              }}
            >
              <div 
                onPointerDown={e => {
                  if (e.target.tagName !== 'BUTTON' && scrollRef.current && !isLocked) {
                    const containerRect = scrollRef.current.getBoundingClientRect();
                    const canvasX = (e.clientX - containerRect.left + scrollRef.current.scrollLeft - offsetX) / zoomLevel;
                    const canvasY = (e.clientY - containerRect.top + scrollRef.current.scrollTop - offsetY) / zoomLevel;
                    setDraggingMemo({ id: m.id, ox: canvasX - m.x, oy: canvasY - m.y });
                  }
                }}
                style={{ 
                  height: '24px', borderBottom: '1px solid black', display: 'flex', 
                  alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', 
                  cursor: isLocked ? 'not-allowed' : 'grab', backgroundColor: 'rgba(0, 0, 0, 0.26)', flexShrink: 0 
                }}
              >
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', minWidth: 0 }}>
                  {m.author && (
                    <span style={{ fontSize: `${16}px`, fontWeight: 'normal', color: m.titleColor || textColor, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.author} {isLocked && `(수정 중: ${lockedMemos[m.id]})`}
                    </span>
                  )}
                  <span style={{ fontSize: `${13}px`, fontWeight: 'normal', color: m.titleColor || textColor, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 'auto', marginRight: '8px', opacity: 0.8 }}>
                    {m.date || getFormattedDate()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                  {m.isEditing ? (
                    <button onClick={() => {
                      if (m.title === '' && m.content === '') {
                        setMemos(memos.filter(memo => memo.id !== m.id));
                        if (activeMemoId === m.id) setActiveMemoId(null);
                        
                        if (socketRef.current) {
                          socketRef.current.emit('memo:delete', { padId, id: m.id });
                        }
                      } else {
                        setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isEditing: false } : memo));
                        
                        if (socketRef.current) {
                          socketRef.current.emit('memo:edit-end', { padId, id: m.id });
                        }
                      }
                    }} style={{ border: '1px inset black', background: '#fff', cursor: 'pointer', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', color: '#000000', padding: 0 }}>X</button>
                  ) : (
                    <button onClick={() => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, isExpanded: !memo.isExpanded } : memo))} style={{ border: '1px inset black', background: '#fff', cursor: 'pointer', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 'bold', color: '#000000', padding: 0 }}>
                      {m.isExpanded ? '▲' : '▼'}
                    </button>
                  )}
                </div>
              </div>

              <div 
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  flexDirection: 'column', 
                  overflow: 'hidden', 
                  userSelect: activeMemoId === m.id ? 'text' : 'none' 
                }}
              > 
                {m.isEditing ? (
                  <form onSubmit={e => { 
                    e.preventDefault(); 
                    handlePublish(m.id, e.target.t.value, m.author, e.target.c.value, m.color, e.target.audioFile.files[0], e.target.imageFile.files[0]); 
                  }} style={{ display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', padding: '10px' }}>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input name="t" placeholder="제목" defaultValue={m.title} required style={{ flex: 1, border: 'none', borderBottom: `1px solid ${borderColor}`, color: m.titleColor || textColor, background: 'none', fontSize: `${22}px`, fontWeight: 'normal', flexShrink: 0, minWidth: 0 }} />
                        <input 
                          className="square-color-picker"
                          type="color" 
                          style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                          value={m.titleColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                          onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, titleColor: e.target.value } : memo))}
                          title="제목 색상 변경"
                        />
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                          <label className="file-upload-label" style={{ 
                            color: textColor,
                            border: `1px solid ${borderColor}`,
                            height: '32px',
                            boxSizing: 'border-box',
                            padding: '0 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.1)',
                            borderRadius: '0px',
                            fontSize: '14px',
                            cursor: 'pointer'
                          }}>
                            <span>소리</span>
                            <input name="audioFile" id={`audio-input-${m.id}-desktop`} type="file" accept="audio/*, .mp3, .wav, .m4a, .caf, .aac, .flac, .ogg, .webm, audio/mpeg, audio/mp3, audio/wav, audio/x-wav, audio/x-m4a, audio/m4a, audio/mp4, audio/caf, audio/x-caf" 
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: url, audioFileName: file.name } : memo));
                                }
                              }}
                              style={{ display: 'none' }} 
                            />
                          </label>
                        </div>

                        {m.audioUrl && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                            <span style={{ fontSize: '11px', color: textColor, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontWeight: 'bold' }}>
                              {m.audioFileName}
                            </span>
                            <button 
                              type="button" 
                              onClick={() => {
                                setMemos(memos.map(memo => memo.id === m.id ? { ...memo, audioUrl: null, audioFileName: null } : memo));
                                const input = document.getElementById(`audio-input-${m.id}-desktop`);
                                if (input) input.value = '';
                              }}
                              className="file-upload-label"
                              style={{ 
                                padding: '0 8px', 
                                height: '24px', 
                                color: textColor, 
                                border: `1px solid ${borderColor}`,
                                cursor: 'pointer',
                                background: 'rgba(0,0,0,0.1)',
                                fontSize: '10px',
                                fontWeight: 'bold',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        )}

                        {m.audioUrl && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <WaveformPlayer audioUrl={getResolvedAudioUrl(m.audioUrl)} fileName={m.audioFileName || ''} textColor={textColor} customColor={m.waveformColor} showFileName={false} />
                            </div>
                            <input 
                              className="square-color-picker"
                              type="color" 
                              style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                              value={m.waveformColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                              onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, waveformColor: e.target.value } : memo))}
                              title="파장 색상 변경"
                            />
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                          <label className="file-upload-label" style={{ 
                            color: textColor,
                            border: `1px solid ${borderColor}`,
                            height: '32px',
                            boxSizing: 'border-box',
                            padding: '0 12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.1)',
                            borderRadius: '0px',
                            fontSize: '14px',
                            cursor: 'pointer'
                          }}>
                            <span>장면</span>
                            <input name="imageFile" id={`image-input-${m.id}-desktop`} type="file" accept="image/*" 
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file) {
                                  const url = URL.createObjectURL(file);
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: url, imageFileName: file.name } : memo));
                                }
                              }}
                              style={{ display: 'none' }} 
                            />
                          </label>
                        </div>

                        {m.imageUrl && (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginBottom: '4px' }}>
                              <span style={{ fontSize: `${10}px`, color: textColor, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {m.imageFileName}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setMemos(memos.map(memo => memo.id === m.id ? { ...memo, imageUrl: null, imageFileName: null } : memo));
                                  const input = document.getElementById(`image-input-${m.id}-desktop`);
                                  if (input) input.value = '';
                                }}
                                className="file-upload-label"
                                style={{ 
                                  padding: '0 8px', 
                                  height: '24px', 
                                  color: textColor, 
                                  border: `1px solid ${borderColor}`,
                                  cursor: 'pointer',
                                  background: 'rgba(0,0,0,0.1)',
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                              >
                                삭제
                              </button>
                            </div>
                            <img src={getResolvedImageUrl(m.imageUrl)} alt="Preview" style={{ maxWidth: '100%', objectFit: 'contain', maxHeight: '150px' }} />
                          </div>
                        )}
                      </div>
                      
                      <textarea name="c" placeholder="내용..." defaultValue={m.content} required style={{ border: `1px solid ${borderColor}`, color: m.contentColor || textColor, background: 'transparent', flex: 1, minHeight: '150px', resize: 'none', fontSize: `${18}px`, padding: '14px' }} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justify: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                      <input 
                        className="square-color-picker"
                        type="color" 
                        style={{ width: '32px', height: '32px', flexShrink: 0 }} 
                        value={m.contentColor || (textColor === '#ffffff' ? '#ffffff' : '#000000')} 
                        onChange={(e) => setMemos(memos.map(memo => memo.id === m.id ? { ...memo, contentColor: e.target.value } : memo))}
                        title="내용 폰트 색상 변경"
                      />
                      <button type="submit" className="file-upload-label" style={{
                        color: textColor,
                        border: `1px solid ${borderColor}`,
                        height: '32px',
                        boxSizing: 'border-box',
                        padding: '0 20px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.1)',
                        borderRadius: '0px'
                      }}>
                        {(m.title === '' && m.content === '') ? '쓰기' : '완료'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
                      <div style={{ paddingBottom: '0px', marginBottom: '0px', flexShrink: 0 }}>
                        <div style={{ fontSize: `${22}px`, fontWeight: 'normal', color: m.titleColor || textColor, marginBottom: '8px' }}>{m.title}</div>
                      </div>

                      {m.audioUrl && (
                        <div style={{ marginTop: '5px', marginBottom: '5px' }}>
                          <WaveformPlayer audioUrl={getResolvedAudioUrl(m.audioUrl)} fileName={m.audioFileName || ''} textColor={textColor} customColor={m.waveformColor} />
                        </div>
                      )}
                      
                      {m.imageUrl && (
                        <div style={{ marginTop: '5px', marginBottom: '5px' }}>
                          <div style={{ fontSize: `${10}px`, color: textColor, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                            {m.imageFileName}
                          </div>
                          <img src={getResolvedImageUrl(m.imageUrl)} alt="Uploaded" style={{ width: '100%', objectFit: 'contain', marginBottom: '8px', }} />
                        </div>
                      )}
                      
                      {m.isExpanded && (
                        <div style={{ color: m.contentColor || textColor, fontSize: `${14}px`, lineHeight: '1.6', wordBreak: 'break-all', marginTop: '10px' }}>
                          {m.content}
                        </div>
                      )}
                    </div>

                    {m.isExpanded && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '12px 10px', backgroundColor: 'transparent', flexShrink: 0 }}>
                        {isLocked ? (
                          <span style={{ fontSize: '13px', color: textColor, opacity: 0.8, fontStyle: 'italic' }}>
                            {lockedMemos[m.id]}님이 수정 중...
                          </span>
                        ) : (
                          <>
                            <button onClick={() => handleEditMemo(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: `${14}px`, color: textColor, textDecoration: 'underline' }}>수정</button>
                            <button 
                              onClick={() => handleDeleteMemo(m.id)} 
                              style={{ 
                                background: deleteConfirmMemoId === m.id ? (isReddish(m.color) ? '#000000' : '#d9534f') : 'none', 
                                border: 'none', 
                                cursor: 'pointer', 
                                fontSize: `${14}px`, 
                                color: deleteConfirmMemoId === m.id ? 'white' : textColor, 
                                padding: deleteConfirmMemoId === m.id ? '2px 6px' : '0',
                                borderRadius: '0px',
                                textDecoration: deleteConfirmMemoId === m.id ? 'none' : 'underline',
                                fontWeight: deleteConfirmMemoId === m.id ? 'bold' : 'normal',
                                transition: 'all 0.2s'
                              }}
                            >
                              {deleteConfirmMemoId === m.id ? '확인' : '삭제'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </main>
          </div>
        </div>
      </div>

      <div style={{
          position: 'fixed', bottom: '20px', right: '20px',
          transform: `scale(${uiScale})`, transformOrigin: 'bottom right', 
          zIndex: 2000,
      }}>
        <div 
          ref={minimapRef}
          onPointerDown={handleMinimapPointerDown}
          style={{
            width: `${MINIMAP_SIZE}px`, height: `${MINIMAP_SIZE}px`, 
            backgroundColor: isWhiteOrVeryLight(outerBgColor || '#E0E0D0') ? '#E8E8E8' : '#ffffff', 
            border: isWhiteOrVeryLight(outerBgColor || '#E0E0D0') ? '1px solid #d0d0d0' : 'none', 
            cursor: isDraggingMinimap ? 'grabbing' : 'crosshair',
            touchAction: 'none',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
        {memos.map(m => {
          const w = memoSizes[m.id] ? memoSizes[m.id].w : 340;
          const h = memoSizes[m.id] ? memoSizes[m.id].h : (m.isEditing ? 400 : 200);
          return (
            <div key={`mini-${m.id}`} style={{
              position: 'absolute',
              left: m.x * scaleRate, top: m.y * scaleRate,
              width: Math.max(16, w * scaleRate) + 'px',
              height: Math.max(12, h * scaleRate) + 'px',
              backgroundColor: m.color, border: '1px solid #000', boxShadow: '1px 1px 0px rgba(0,0,0,0.5)', boxSizing: 'border-box'
            }} />
          );
        })}
        <div style={{
          position: 'absolute',
          left: ((scrollPos.left - offsetX) / zoomLevel) * scaleRate, top: ((scrollPos.top - offsetY) / zoomLevel) * scaleRate,
          width: (viewportSize.width / zoomLevel) * scaleRate, height: (viewportSize.height / zoomLevel) * scaleRate,
          border: '1px solid red', backgroundColor: 'rgba(255, 0, 0, 0.1)',
          pointerEvents: 'none' 
        }} />
      </div>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()} style={{ position: 'fixed', bottom: '20px', left: '50%', transform: `translateX(-50%) scale(${uiScale})`, transformOrigin: 'bottom center', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', padding: '6px 10px', border: 'none', width: '250px', height: '52px', boxSizing: 'border-box' }}>
        {(() => {
          const zoomStages = [minZoom, minZoom + (1.0 - minZoom) * 0.5, 1.0, 1.5];
          let currentStage = 0;
          let minDiff = Infinity;
          zoomStages.forEach((val, i) => {
            const diff = Math.abs(val - zoomLevel);
            if (diff < minDiff) { minDiff = diff; currentStage = i; }
          });
          
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '4px', padding: '0 5px', boxSizing: 'border-box' }}>
                <div style={{ width: '2px', height: '10px', backgroundColor: '#000' }}></div>
                <div style={{ width: '2px', height: '10px', backgroundColor: '#000' }}></div>
                <div style={{ width: '2px', height: '10px', backgroundColor: '#000' }}></div>
                <div style={{ width: '2px', height: '10px', backgroundColor: '#000' }}></div>
              </div>
              <input 
                type="range" 
                className="custom-zoom-slider"
                min="0" max="3" step="1" 
                value={currentStage}
                onChange={(e) => handleZoomChange(zoomStages[e.target.value])}
                style={{ width: '100%' }}
              />
            </div>
          );
        })()}
        </div>
      </div>

    </div>
  );
}