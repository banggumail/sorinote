import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';

const DEFAULT_SETTINGS = {
  bgColor: '#000000',
  titleText: '2bpencil',
  titleColor: '#fcff52',
  descText: 'sorinote.2bpencil.online',
  descColor: '#fcff52',
  adminBgColor: '#000000',
  adminFontColor: '#ffffff',
  descImage: ''
};

function getReadableColor(bgColor, currentColor) {
  if (!bgColor) return '#000000';
  const hexBg = bgColor.replace('#', '');
  const rBg = parseInt(hexBg.substring(0, 2), 16);
  const gBg = parseInt(hexBg.substring(2, 4), 16);
  const bBg = parseInt(hexBg.substring(4, 6), 16);
  const yiqBg = ((rBg * 299) + (gBg * 587) + (bBg * 114)) / 1000;
  const isBgDark = yiqBg < 128;

  if (!currentColor) return isBgDark ? '#ffffff' : '#000000';
  
  const hexText = currentColor.replace('#', '');
  const rText = parseInt(hexText.substring(0, 2), 16);
  const gText = parseInt(hexText.substring(2, 4), 16);
  const bText = parseInt(hexText.substring(4, 6), 16);
  const yiqText = ((rText * 299) + (gText * 587) + (bText * 114)) / 1000;
  const isTextDark = yiqText < 128;

  if (isBgDark === isTextDark) {
    return isBgDark ? '#ffffff' : '#000000';
  }
  return currentColor;
}

function getComplementaryColor(hexColor) {
  if (!hexColor) return 'rgba(255, 235, 59, 0.4)';
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  const compR = 255 - r;
  const compG = 255 - g;
  const compB = 255 - b;
  
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness < 50) {
    return 'rgba(255, 235, 59, 0.6)';
  }
  if (brightness > 220) {
    return 'rgba(0, 0, 0, 0.35)';
  }
  return `rgba(${compR}, ${compG}, ${compB}, 0.45)`;
}

export default function Admin() {
  const [padId, setPadId] = useState('');
  const [padTitle, setPadTitle] = useState('');
  const [initCanvasBg, setInitCanvasBg] = useState('#FDFBF7');
  const [initOuterBg, setInitOuterBg] = useState('#E0E0D0');
  const [initTitleColor, setInitTitleColor] = useState('#0056b3');
  const [isPrivate, setIsPrivate] = useState(false);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [recentPads, setRecentPads] = useState([]);
  const [editingPadId, setEditingPadId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const [isTitleColorCustomized, setIsTitleColorCustomized] = useState(false);
  const [isDescColorCustomized, setIsDescColorCustomized] = useState(false);

  // Password Protection States
  const [hasPassword, setHasPassword] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('admin_authenticated') === 'true';
  });
  const [isSettingOpen, setIsSettingOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [settingsMode, setSettingsMode] = useState('menu'); // 'menu' | 'change' | 'remove'
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [storageSize, setStorageSize] = useState(null);

  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    fetch(`${API_BASE}/api/admin/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: loginPassword })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          sessionStorage.setItem('admin_authenticated', 'true');
          setIsAuthenticated(true);
          setLoginError('');
        } else {
          setLoginError(data.error || 'Incorrect password');
        }
      })
      .catch(err => {
        console.error('Error logging in:', err);
        setLoginError('Error logging in');
      });
  };

  const handleSetPassword = (e) => {
    e.preventDefault();
    fetch(`${API_BASE}/api/admin/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('Password successfully set!');
          setNewPassword('');
          setIsSettingOpen(false);
          setHasPassword(true);
        } else {
          alert(data.error || 'Error setting password');
        }
      })
      .catch(err => console.error('Error setting password:', err));
  };

  const handleChangePassword = (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert('New passwords do not match.');
      return;
    }
    fetch(`${API_BASE}/api/admin/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: currentPassword, newPassword })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('Password successfully changed!');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setIsSettingOpen(false);
          setSettingsMode('menu');
          if (!newPassword || newPassword.trim() === '') {
            setHasPassword(false);
            sessionStorage.removeItem('admin_authenticated');
            setIsAuthenticated(false);
          }
        } else {
          alert(data.error || 'Error changing password');
        }
      })
      .catch(err => console.error('Error changing password:', err));
  };

  const handleRemovePassword = (e) => {
    e.preventDefault();
    if (!currentPassword || currentPassword.trim() === '') {
      alert('Please enter your current password first.');
      return;
    }
    fetch(`${API_BASE}/api/admin/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: currentPassword, newPassword: '' })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('Password successfully removed!');
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setIsSettingOpen(false);
          setSettingsMode('menu');
          setHasPassword(false);
          sessionStorage.removeItem('admin_authenticated');
          setIsAuthenticated(false);
        } else {
          alert(data.error || 'Error removing password');
        }
      })
      .catch(err => console.error('Error removing password:', err));
  };


  const loadPads = () => {
    fetch(`${API_BASE}/api/pads`)
      .then(res => res.json())
      .then(data => {
        setRecentPads(data);
      })
      .catch(err => console.error('Error loading pads:', err));
  };

  const loadStorageSize = () => {
    fetch(`${API_BASE}/api/admin/storage-size`)
      .then(res => res.json())
      .then(data => {
        setStorageSize(data);
      })
      .catch(err => console.error('Error loading storage size:', err));
  };

  const formatBytes = (bytes) => {
    if (bytes === undefined || bytes === null) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  useEffect(() => {
    document.title = 'sorinote_admin';
    fetch(`${API_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        const merged = { ...DEFAULT_SETTINGS, ...data };
        setSettings(merged);
        setDraftSettings(merged);
      })
      .catch(err => console.error('Error loading settings:', err));
    loadPads();
    loadStorageSize();

    // Check password status
    fetch(`${API_BASE}/api/admin/has-password`)
      .then(res => res.json())
      .then(data => {
        setHasPassword(data.hasPassword);
      })
      .catch(err => console.error('Error checking password status:', err));
  }, []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = draftSettings.adminBgColor;
    document.body.style.backgroundColor = draftSettings.adminBgColor;
  }, [draftSettings.adminBgColor]);

  const updateDraftSetting = (key, value) => {
    setDraftSettings(prev => {
      let updated = { ...prev, [key]: value };
      
      // Only adjust titleColor and descColor when the background color changes AND they are not manually customized
      if (key === 'bgColor') {
        if (!isTitleColorCustomized) {
          updated.titleColor = getReadableColor(value, updated.titleColor);
        }
        if (!isDescColorCustomized) {
          updated.descColor = getReadableColor(value, updated.descColor);
        }
      }
      
      return updated;
    });

    if (key === 'titleColor') {
      setIsTitleColorCustomized(true);
    }
    if (key === 'descColor') {
      setIsDescColorCustomized(true);
    }
  };

  const handleUploadDescImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        if (data.fileUrl) {
          updateDraftSetting('descImage', data.fileUrl);
        } else {
          alert('Upload failed: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(err => {
        console.error('Error uploading description image:', err);
        alert('Upload failed');
      });
  };

  const handleSaveSettings = () => {
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftSettings)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSettings(draftSettings);
          alert('설정이 저장되었습니다.');
        }
      })
      .catch(err => console.error('Error updating settings:', err));
  };

  const handleCopyUrl = (id) => {
    const url = `${window.location.origin}/${id}`;
    navigator.clipboard.writeText(url)
      .then(() => alert('주소가 복사되었습니다.'))
      .catch(err => console.error('Failed to copy:', err));
  };

  const handleCreatePad = (e) => {
    e.preventDefault();
    if (padId.trim() !== '' && padTitle.trim() !== '') {
      const id = padId.trim();
      const title = padTitle.trim();
      const date = new Date();
      const formattedDate = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
      const newPad = { id, title, date: formattedDate, canvasBgColor: initCanvasBg, outerBgColor: initOuterBg, titleColor: initTitleColor, isPrivate: isPrivate ? 1 : 0 };

      fetch(`${API_BASE}/api/pads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPad)
      })
        .then(res => res.json())
        .then(() => {
          setPadId('');
          setPadTitle('');
          setIsPrivate(false);
          loadPads();
        })
        .catch(err => console.error('Error creating pad:', err));
    }
  };

  const handleUpdateWorld = (id, newCanvasBg, newOuterBg, newTitleColor, newIsPrivate) => {
    fetch(`${API_BASE}/api/pads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvasBgColor: newCanvasBg,
        outerBgColor: newOuterBg,
        titleColor: newTitleColor,
        isPrivate: newIsPrivate ? 1 : 0
      })
    })
      .then(res => res.json())
      .then(() => {
        loadPads();
      })
      .catch(err => console.error('Error updating pad:', err));
  };

  const handleDeleteWorld = (id) => {
    if (deleteConfirmId === id) {
      console.log('Second click. Sending DELETE request for:', id);
      fetch(`${API_BASE}/api/pads/${id}`, {
        method: 'DELETE'
      })
        .then(res => res.json())
        .then(data => {
          console.log('DELETE success response data:', data);
          setDeleteConfirmId(null);
          loadPads();
        })
        .catch(err => console.error('Error deleting pad:', err));
    } else {
      console.log('First click. Setting delete confirmation for:', id);
      setDeleteConfirmId(id);
      // Revert back after 3 seconds
      setTimeout(() => {
        setDeleteConfirmId(prev => prev === id ? null : prev);
      }, 3000);
    }
  };

  if (hasPassword && !isAuthenticated) {
    return (
      <div className="app-container" style={{ background: settings.adminBgColor, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <div style={{
          background: settings.bgColor === '#000000' ? '#1a1a1a' : '#ffffff',
          border: '1px solid rgba(128,128,128,0.3)',
          padding: '40px 30px',
          width: '320px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          color: getReadableColor(settings.bgColor === '#000000' ? '#1a1a1a' : '#ffffff', '#000000'),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '15px',
          fontFamily: 'inherit'
        }}>
          <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Admin Login</h2>
          {loginError && <p style={{ color: '#ff4d4f', fontSize: '13px', margin: 0 }}>{loginError}</p>}
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <input 
              type="password" 
              placeholder="password" 
              value={loginPassword} 
              onChange={e => setLoginPassword(e.target.value)} 
              required
              autoFocus
              style={{ padding: '8px', fontSize: '14px', border: '1px solid #ccc', background: 'transparent', color: 'inherit', fontFamily: 'inherit' }}
            />
            <button type="submit" className="admin-btn" style={{ padding: '8px', fontSize: '14px', width: '100%' }}>
              login
            </button>
          </form>
        </div>
      </div>
    );
  }

  const adminTextColor = draftSettings.adminFontColor || '#ffffff';

  return (
    <div className="app-container" style={{ background: draftSettings.adminBgColor }}>
      <div className="app-content">

        {/* Admin Background and Font color pickers above Main Settings Box */}
        <div className="admin-header-row">
          <div className="admin-header-pickers" style={{ flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: adminTextColor }}>admin_bg:</span>
              <input 
                type="color" 
                value={draftSettings.adminBgColor} 
                onChange={(e) => updateDraftSetting('adminBgColor', e.target.value)} 
                style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} 
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: adminTextColor }}>admin_font_color:</span>
              <input 
                type="color" 
                value={draftSettings.adminFontColor || '#ffffff'} 
                onChange={(e) => updateDraftSetting('adminFontColor', e.target.value)} 
                style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} 
              />
            </div>
            {storageSize && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: adminTextColor, border: `1px solid rgba(128,128,128,0.3)`, padding: '2px 8px', background: 'rgba(128,128,128,0.05)', fontFamily: 'monospace' }}>
                <span>db: {formatBytes(storageSize.dbSize)}</span>
                <span>/</span>
                <span>uploads: {formatBytes(storageSize.uploadsSize)}</span>
                <button 
                  type="button" 
                  onClick={loadStorageSize} 
                  className="admin-btn"
                  style={{ padding: '0 4px', fontSize: '10px', height: '18px', display: 'inline-flex', alignItems: 'center', marginLeft: '4px' }}
                >
                  refresh
                </button>
              </div>
            )}
          </div>

          {/* Settings Menu Trigger and Popover */}
          <div className="admin-header-settings">
            <button 
              onClick={() => {
                setIsSettingOpen(!isSettingOpen);
                setSettingsMode('menu');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }} 
              className="admin-btn"
              style={{ padding: '4px 10px', fontSize: '14px' }}
            >
              settings
            </button>
            {isSettingOpen && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '40px',
                width: '260px',
                background: draftSettings.bgColor === '#000000' ? '#1a1a1a' : '#ffffff',
                border: '1px solid rgba(128,128,128,0.3)',
                padding: '15px',
                zIndex: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                color: getReadableColor(draftSettings.bgColor === '#000000' ? '#1a1a1a' : '#ffffff', '#000000')
              }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', borderBottom: '1px solid rgba(128,128,128,0.2)', paddingBottom: '5px' }}>
                  Admin Password
                </h3>
                {hasPassword ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {settingsMode === 'menu' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button 
                          type="button" 
                          onClick={() => setSettingsMode('change')} 
                          className="admin-btn" 
                          style={{ width: '100%', padding: '6px' }}
                        >
                          change password
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setSettingsMode('remove')} 
                          className="admin-btn" 
                          style={{ 
                            width: '100%', 
                            padding: '6px', 
                            color: '#ff4d4f', 
                            borderColor: '#ff4d4f',
                            backgroundColor: 'transparent'
                          }}
                        >
                          remove password
                        </button>
                      </div>
                    )}

                    {settingsMode === 'change' && (
                      <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input 
                          type="password" 
                          placeholder="current password" 
                          value={currentPassword} 
                          onChange={e => setCurrentPassword(e.target.value)} 
                          required
                          style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', background: 'transparent', color: 'inherit' }}
                        />
                        <input 
                          type="password" 
                          placeholder="new password" 
                          value={newPassword} 
                          onChange={e => setNewPassword(e.target.value)} 
                          required
                          style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', background: 'transparent', color: 'inherit' }}
                        />
                        <input 
                          type="password" 
                          placeholder="confirm new password" 
                          value={confirmPassword} 
                          onChange={e => setConfirmPassword(e.target.value)} 
                          required
                          style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', background: 'transparent', color: 'inherit' }}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" onClick={() => { setSettingsMode('menu'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }} className="admin-btn" style={{ flex: 1, padding: '6px' }}>
                            back
                          </button>
                          <button type="submit" className="admin-btn" style={{ flex: 1, padding: '6px', fontWeight: 'bold' }}>
                            confirm
                          </button>
                        </div>
                      </form>
                    )}

                    {settingsMode === 'remove' && (
                      <form onSubmit={handleRemovePassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input 
                          type="password" 
                          placeholder="current password" 
                          value={currentPassword} 
                          onChange={e => setCurrentPassword(e.target.value)} 
                          required
                          style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', background: 'transparent', color: 'inherit' }}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" onClick={() => { setSettingsMode('menu'); setCurrentPassword(''); }} className="admin-btn" style={{ flex: 1, padding: '6px' }}>
                            back
                          </button>
                          <button 
                            type="submit" 
                            className="admin-btn" 
                            style={{ 
                              flex: 1, 
                              padding: '6px', 
                              fontWeight: 'bold',
                              color: '#ff4d4f', 
                              borderColor: '#ff4d4f',
                              backgroundColor: 'transparent'
                            }}
                          >
                            confirm
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleSetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input 
                      type="password" 
                      placeholder="set password" 
                      value={newPassword} 
                      onChange={e => setNewPassword(e.target.value)} 
                      required
                      style={{ padding: '6px', fontSize: '13px', border: '1px solid #ccc', background: 'transparent', color: 'inherit' }}
                    />
                    <button type="submit" className="admin-btn" style={{ width: '100%', padding: '6px' }}>
                      set password
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main Page Preview WYSIWYG Card */}
        <div className="admin-settings-card admin-page-settings-card" style={{ background: draftSettings.bgColor }}>
        {/* Main bg color picker above title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px' }}>
          <span style={{ fontSize: '14px', fontWeight: 'bold', color: getReadableColor(draftSettings.bgColor, '#000000') }}>main_bg:</span>
          <input 
            type="color" 
            value={draftSettings.bgColor} 
            onChange={(e) => updateDraftSetting('bgColor', e.target.value)} 
            style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} 
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '0 0 15px 0' }}>
          <input
            value={draftSettings.titleText}
            onChange={(e) => updateDraftSetting('titleText', e.target.value)}
            style={{
              fontSize: 'clamp(1.6rem, 5vw, 2.5rem)', margin: 0, padding: 0, border: '1px dashed rgba(128,128,128,0.3)',
              background: 'transparent', color: draftSettings.titleColor, fontWeight: 'bold', outline: 'none',
              width: '100%', fontFamily: 'inherit'
            }}
          />
          <input 
            type="color" 
            value={draftSettings.titleColor} 
            onChange={(e) => updateDraftSetting('titleColor', e.target.value)} 
            style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, background: 'transparent', marginTop: '6px' }} 
            title="타이틀 색상" 
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', margin: '0' }}>
          <textarea
            value={draftSettings.descText}
            onChange={(e) => updateDraftSetting('descText', e.target.value)}
            style={{
              margin: 0, padding: 0, color: draftSettings.descColor, fontSize: 'clamp(1rem, 3.5vw, 1.2rem)', lineHeight: '1.6',
              border: '1px dashed rgba(128,128,128,0.3)', background: 'transparent', outline: 'none',
              width: '100%', minHeight: '80px', resize: 'vertical', fontFamily: 'inherit', whiteSpace: 'pre-wrap'
            }}
          />
          <input 
            type="color" 
            value={draftSettings.descColor} 
            onChange={(e) => updateDraftSetting('descColor', e.target.value)} 
            style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, background: 'transparent', marginTop: '2px' }} 
            title="설명 색상" 
          />
        </div>

        {/* Description Image Upload in Admin WYSIWYG */}
        <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {draftSettings.descImage ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: 'fit-content' }}>
              <div style={{ padding: 0 }}>
                <img 
                  src={`${API_BASE}${draftSettings.descImage}`} 
                  alt="Description Preview" 
                  style={{ maxHeight: '150px', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button 
                  type="button"
                  onClick={() => updateDraftSetting('descImage', '')}
                  className="admin-btn"
                  style={{
                    color: '#ff4d4f',
                    borderColor: '#ff4d4f',
                    backgroundColor: 'transparent',
                    padding: '2px 8px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  delete
                </button>
              </div>
            </div>
          ) : (
            <div className="admin-upload-image-wrapper">
              <label 
                className="admin-btn" 
                style={{ 
                  cursor: 'pointer',
                  fontSize: '13px',
                  padding: '6px 12px'
                }}
              >
                upload image
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleUploadDescImage}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div style={{ marginBottom: '40px', display: 'flex', justifyContent: 'flex-end' }}>
        <button 
          onClick={handleSaveSettings}
          className="admin-btn"
        >
          save
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(128,128,128,0.3)', margin: '40px 0' }} />

      {/* Create World Section */}
      <h2 style={{ fontSize: '1.5rem', margin: '0 0 20px 0', color: adminTextColor }}>Create world</h2>
      
      <div className="create-world-container">
        <form onSubmit={handleCreatePad} className="create-world-form">
          <div className="create-world-inputs-col">
            {/* URL Input matching width of World Name Input */}
            <div className="create-world-input-item" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="url"
                value={padId}
                onChange={(e) => setPadId(e.target.value)}
                style={{ padding: '8px', fontSize: '16px', border: '1px solid #ccc', fontFamily: 'inherit', flex: 1 }}
              />
              <div style={{ width: '32px', height: '32px', flexShrink: 0 }} /> {/* spacer matching the color picker */}
            </div>

            {/* World Name Input */}
            <div className="create-world-input-item" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="world name"
                value={padTitle}
                onChange={(e) => setPadTitle(e.target.value)}
                style={{ padding: '8px', fontSize: '16px', border: '1px solid #ccc', fontFamily: 'inherit', flex: 1 }}
              />
              <input type="color" value={initTitleColor} onChange={e => setInitTitleColor(e.target.value)} style={{ width: '32px', height: '32px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} title="세계 제목 색상 선택" />
            </div>

            {/* Color Pickers (world_bg, canvas_bg) */}
            <div className="create-world-pickers-row" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label style={{ fontSize: '14px', color: adminTextColor, display: 'flex', alignItems: 'center', gap: '5px' }}>
                world_bg:
                <input type="color" value={initOuterBg} onChange={e => setInitOuterBg(e.target.value)} style={{ width: '32px', height: '32px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} title="전체 배경색 선택" />
              </label>
              <label style={{ fontSize: '14px', color: adminTextColor, display: 'flex', alignItems: 'center', gap: '5px' }}>
                canvas_bg:
                <input type="color" value={initCanvasBg} onChange={e => setInitCanvasBg(e.target.value)} style={{ width: '32px', height: '32px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} title="캔버스 색상 선택" />
              </label>
            </div>

            {/* Private Checkbox */}
            <div className="create-world-private-row" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label style={{ fontSize: '14px', color: adminTextColor, display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={isPrivate} 
                  onChange={(e) => setIsPrivate(e.target.checked)} 
                  style={{ cursor: 'pointer' }}
                />
                private
              </label>
            </div>

            {/* Create Button aligned and customized */}
            <div className="admin-create-btn-wrapper">
              <button 
                type="submit" 
                className="admin-btn"
              >
                create
              </button>
              <div className="admin-create-btn-spacer" />
            </div>
          </div>

          <div className="create-world-mockup-col">
            {/* Mockup preview of the pad to be created */}
            <div 
              className="create-world-mockup"
              style={{ background: initOuterBg }}
              title="생성될 패드 모형 예시"
            >
              {/* Canvas block inside pad */}
              <div style={{ 
                width: '100%', 
                height: '100%', 
                background: initCanvasBg, 
                border: '1px solid rgba(0,0,0,0.1)', 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'center',
                alignItems: 'flex-start',
                padding: '15px',
                boxSizing: 'border-box',
                transition: 'background 0.3s'
              }}>
                {/* Dynamic URL Preview above the title */}
                <span style={{ 
                  fontSize: '0.9rem', 
                  color: getReadableColor(initCanvasBg, '#000000'), 
                  marginBottom: '10px',
                  opacity: 0.8,
                  wordBreak: 'break-all',
                  textAlign: 'left'
                }}>
                  {window.location.origin}/{padId.trim() || 'url'}
                </span>
                <span style={{ 
                  background: getComplementaryColor(initTitleColor || '#0056b3'),
                  color: initTitleColor || '#0056b3',
                  padding: '2px 8px',
                  fontWeight: 'bold',
                  fontSize: '1.4rem',
                  borderRadius: '0px',
                  display: 'inline-block',
                  textAlign: 'left',
                  wordBreak: 'break-all',
                  transition: 'all 0.3s'
                }}>
                  {padTitle.trim() || 'world name'}
                </span>
              </div>
            </div>
          </div>
        </form>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(128,128,128,0.3)', margin: '40px 0' }} />

      <h2 style={{ fontSize: '1.5rem', margin: '0 0 20px 0', color: adminTextColor }}>World list</h2>
      {recentPads.length === 0 ? (
        <p style={{ color: adminTextColor, opacity: 0.8, fontSize: '1.1rem' }}>n/a</p>
      ) : (
        <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
          {recentPads.map(pad => (
            <li key={pad.id} className="pad-list-item">
              {/* Desktop Layout */}
              <div className="admin-pad-row desktop-only" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '15px', flexWrap: 'wrap' }}>
                  <span className="pad-date" style={{ color: adminTextColor }}>{pad.date}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => navigate(`/${pad.id}`)}
                      className="pad-title-btn"
                      style={{
                        background: getComplementaryColor(pad.titleColor || '#0056b3'),
                        color: pad.titleColor || '#0056b3',
                        width: 'fit-content'
                      }}
                    >
                      {pad.title}
                    </button>
                    {pad.isPrivate === 1 ? (
                      <span style={{ 
                        fontSize: '11px', 
                        color: '#ff4d4f', 
                        border: '1px solid #ff4d4f',
                        padding: '1px 5px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        private
                      </span>
                    ) : (
                      <span style={{ 
                        fontSize: '11px', 
                        color: '#2ea44f', 
                        border: '1px solid #2ea44f',
                        padding: '1px 5px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        public
                      </span>
                    )}
                  </div>

                  <div className="admin-pad-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button 
                      onClick={() => handleCopyUrl(pad.id)}
                      className="admin-btn copy-url-btn"
                    >
                      copy url
                    </button>
                    {editingPadId === pad.id ? (
                      <button onClick={() => setEditingPadId(null)} className="admin-btn">
                        cancel
                      </button>
                    ) : (
                      <button onClick={() => setEditingPadId(pad.id)} className="admin-btn">
                        edit
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteWorld(pad.id)}
                      className="admin-btn"
                      style={{
                        color: deleteConfirmId === pad.id ? 'white' : 'red',
                        backgroundColor: deleteConfirmId === pad.id ? '#d9534f' : 'transparent',
                        borderColor: deleteConfirmId === pad.id ? '#d43f3a' : '#ccc',
                        fontWeight: deleteConfirmId === pad.id ? 'bold' : 'normal'
                      }}
                    >
                      {deleteConfirmId === pad.id ? 'confirm' : 'delete'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div className="desktop-only-spacer" style={{ flexShrink: 0 }}>
                      <span className="pad-date" style={{ visibility: 'hidden', display: 'inline-block' }}>
                        {pad.date}
                      </span>
                    </div>
                    <span className="pad-url" style={{ color: adminTextColor }}>
                      {window.location.origin}/{pad.id}
                    </span>
                  </div>

                  {editingPadId === pad.id && (
                    <div className="admin-edit-panel">
                      <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                        title <input type="color" value={pad.titleColor || '#0056b3'} onChange={e => {
                          const newPads = [...recentPads];
                          const idx = newPads.findIndex(p => p.id === pad.id);
                          newPads[idx].titleColor = e.target.value;
                          setRecentPads(newPads);
                        }} style={{ width: '18px', height: '18px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} />
                      </label>
                      <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                        canvas <input type="color" value={pad.canvasBgColor || '#FDFBF7'} onChange={e => {
                          const newPads = [...recentPads];
                          const idx = newPads.findIndex(p => p.id === pad.id);
                          newPads[idx].canvasBgColor = e.target.value;
                          setRecentPads(newPads);
                        }} style={{ width: '18px', height: '18px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} />
                      </label>
                      <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                        background <input type="color" value={pad.outerBgColor || '#E0E0D0'} onChange={e => {
                          const newPads = [...recentPads];
                          const idx = newPads.findIndex(p => p.id === pad.id);
                          newPads[idx].outerBgColor = e.target.value;
                          setRecentPads(newPads);
                        }} style={{ width: '18px', height: '18px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} />
                      </label>
                      <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}>
                        private <input type="checkbox" checked={pad.isPrivate === 1} onChange={e => {
                          const newPads = [...recentPads];
                          const idx = newPads.findIndex(p => p.id === pad.id);
                          newPads[idx].isPrivate = e.target.checked ? 1 : 0;
                          setRecentPads(newPads);
                        }} style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
                      </label>
                      <button onClick={() => {
                        handleUpdateWorld(pad.id, pad.canvasBgColor || '#FDFBF7', pad.outerBgColor || '#E0E0D0', pad.titleColor || '#0056b3', pad.isPrivate === 1);
                        setEditingPadId(null);
                      }} className="admin-btn" style={{ padding: '2px 8px', fontSize: '12px' }}>save</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile Layout (Order: Date -> Title -> URL -> Menu) */}
              <div className="admin-pad-row mobile-only" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}>
                {/* 1. Date & Badge Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span className="pad-date" style={{ color: adminTextColor }}>{pad.date}</span>
                  {pad.isPrivate === 1 ? (
                    <span style={{ 
                      fontSize: '11px', 
                      color: '#ff4d4f', 
                      border: '1px solid #ff4d4f',
                      padding: '1px 5px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      private
                    </span>
                  ) : (
                    <span style={{ 
                      fontSize: '11px', 
                      color: '#2ea44f', 
                      border: '1px solid #2ea44f',
                      padding: '1px 5px',
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      public
                    </span>
                  )}
                </div>

                {/* 2. Title Row */}
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <button
                    onClick={() => navigate(`/${pad.id}`)}
                    className="pad-title-btn"
                    style={{
                      background: getComplementaryColor(pad.titleColor || '#0056b3'),
                      color: pad.titleColor || '#0056b3',
                      width: 'fit-content'
                    }}
                  >
                    {pad.title}
                  </button>
                </div>

                {/* 3. Menu (Actions) */}
                <div className="admin-pad-actions" style={{ display: 'flex', gap: '8px', width: '100%', marginLeft: 0 }}>
                  <button 
                    onClick={() => handleCopyUrl(pad.id)}
                    className="admin-btn copy-url-btn"
                    style={{ flex: 1 }}
                  >
                    copy url
                  </button>
                  {editingPadId === pad.id ? (
                    <button onClick={() => setEditingPadId(null)} className="admin-btn" style={{ flex: 1 }}>
                      cancel
                    </button>
                  ) : (
                    <button onClick={() => setEditingPadId(pad.id)} className="admin-btn" style={{ flex: 1 }}>
                      edit
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteWorld(pad.id)}
                    className="admin-btn"
                    style={{
                      flex: 1,
                      color: deleteConfirmId === pad.id ? 'white' : 'red',
                      backgroundColor: deleteConfirmId === pad.id ? '#d9534f' : 'transparent',
                      borderColor: deleteConfirmId === pad.id ? '#d43f3a' : '#ccc',
                      fontWeight: deleteConfirmId === pad.id ? 'bold' : 'normal'
                    }}
                  >
                    {deleteConfirmId === pad.id ? 'confirm' : 'delete'}
                  </button>
                </div>

                {/* 4. URL */}
                <span className="pad-url" style={{ color: adminTextColor, wordBreak: 'break-all' }}>
                  {window.location.origin}/{pad.id}
                </span>

                {/* 5. Edit panel */}
                {editingPadId === pad.id && (
                  <div className="admin-edit-panel" style={{ width: '100%', marginTop: '4px' }}>
                    <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                      title <input type="color" value={pad.titleColor || '#0056b3'} onChange={e => {
                        const newPads = [...recentPads];
                        const idx = newPads.findIndex(p => p.id === pad.id);
                        newPads[idx].titleColor = e.target.value;
                        setRecentPads(newPads);
                      }} style={{ width: '18px', height: '18px', border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} />
                    </label>
                    <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                      canvas <input type="color" value={pad.canvasBgColor || '#FDFBF7'} onChange={e => {
                        const newPads = [...recentPads];
                        const idx = newPads.findIndex(p => p.id === pad.id);
                        newPads[idx].canvasBgColor = e.target.value;
                        setRecentPads(newPads);
                      }} style={{ width: '18px', height: '18px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} />
                    </label>
                    <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
                      background <input type="color" value={pad.outerBgColor || '#E0E0D0'} onChange={e => {
                        const newPads = [...recentPads];
                        const idx = newPads.findIndex(p => p.id === pad.id);
                        newPads[idx].outerBgColor = e.target.value;
                        setRecentPads(newPads);
                      }} style={{ width: '18px', height: '18px', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0 }} />
                    </label>
                    <label style={{ color: adminTextColor, display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', cursor: 'pointer' }}>
                      private <input type="checkbox" checked={pad.isPrivate === 1} onChange={e => {
                        const newPads = [...recentPads];
                        const idx = newPads.findIndex(p => p.id === pad.id);
                        newPads[idx].isPrivate = e.target.checked ? 1 : 0;
                        setRecentPads(newPads);
                      }} style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
                    </label>
                    <button onClick={() => {
                      handleUpdateWorld(pad.id, pad.canvasBgColor || '#FDFBF7', pad.outerBgColor || '#E0E0D0', pad.titleColor || '#0056b3', pad.isPrivate === 1);
                      setEditingPadId(null);
                    }} className="admin-btn" style={{ padding: '2px 8px', fontSize: '12px', width: '100%', marginTop: '8px' }}>save</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
