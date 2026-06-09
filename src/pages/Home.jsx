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

export default function Home() {
  const [recentPads, setRecentPads] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const navigate = useNavigate();

  const handleCopyUrl = (id) => {
    const url = `${window.location.origin}/${id}`;
    navigator.clipboard.writeText(url)
      .then(() => alert('주소가 복사되었습니다.'))
      .catch(err => console.error('Failed to copy:', err));
  };

  useEffect(() => {
    // Load Settings
    fetch(`${API_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        setSettings({ ...DEFAULT_SETTINGS, ...data });
      })
      .catch(err => console.error('Error loading settings:', err));

    // Load Pads
    fetch(`${API_BASE}/api/pads`)
      .then(res => res.json())
      .then(data => {
        setRecentPads(data.filter(pad => pad.isPrivate !== 1));
      })
      .catch(err => console.error('Error loading pads:', err));
  }, []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = settings.bgColor;
    document.body.style.backgroundColor = settings.bgColor;
  }, [settings.bgColor]);

  useEffect(() => {
    if (settings.titleText) {
      document.title = `sorinote_${settings.titleText}`;
    } else {
      document.title = 'sorinote_memo';
    }
  }, [settings.titleText]);

  const normalTextColor = settings.descColor;

  return (
    <div className="app-container" style={{ background: settings.bgColor }}>
      <div className="app-content">
        <div className="admin-settings-card" style={{ background: settings.bgColor }}>
          <h1 className="main-title" style={{ color: settings.titleColor }}>
            {settings.titleText}
          </h1>
          <p className="main-desc" style={{ color: settings.descColor, marginBottom: settings.descImage ? '20px' : 0 }}>
            {settings.descText}
          </p>

          {settings.descImage && (
            <div className="main-desc-image-container" style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <img 
                src={`${API_BASE}${settings.descImage}`} 
                alt="Description Graphic" 
                style={{ 
                  maxWidth: '100%', 
                  maxHeight: '400px', 
                  objectFit: 'contain', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }} 
              />
            </div>
          )}
        </div>

        <h2 style={{ fontSize: '1.5rem', margin: '0 0 20px 0', color: normalTextColor }}>World list</h2>
        {recentPads.length === 0 ? (
          <p style={{ color: normalTextColor, opacity: 0.8, fontSize: '1.1rem' }}>n/a</p>
        ) : (
          <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
            {recentPads.map(pad => (
               <li key={pad.id} className="pad-list-item">
                {/* Desktop Layout */}
                <div className="admin-pad-row desktop-only" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '15px', flexWrap: 'wrap' }}>
                    <span className="pad-date" style={{ color: normalTextColor }}>{pad.date}</span>
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
                    </div>
                  </div>

                  <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', width: '100%' }}>
                      <div className="desktop-only-spacer" style={{ flexShrink: 0 }}>
                        <span className="pad-date" style={{ visibility: 'hidden', display: 'inline-block' }}>
                          {pad.date}
                        </span>
                      </div>
                      <span className="pad-url" style={{ color: normalTextColor }}>
                        {window.location.origin}/{pad.id}
                      </span>
                      <button 
                        onClick={() => handleCopyUrl(pad.id)}
                        className="admin-btn copy-url-btn"
                        style={{
                          padding: '2px 8px',
                          fontSize: '11px',
                          height: '22px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          flexShrink: 0,
                          lineHeight: '1',
                          marginLeft: 'auto'
                        }}
                      >
                        copy url
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mobile Layout (Order: Date -> Title -> URL -> Menu) */}
                <div className="admin-pad-row mobile-only" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                  {/* 1. Date & Copy URL Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span className="pad-date" style={{ color: normalTextColor }}>{pad.date}</span>
                    <button 
                      onClick={() => handleCopyUrl(pad.id)}
                      className="admin-btn copy-url-btn"
                      style={{
                        padding: '2px 8px',
                        fontSize: '11px',
                        height: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        flexShrink: 0,
                        lineHeight: '1'
                      }}
                    >
                      copy url
                    </button>
                  </div>

                  {/* 2. Title */}
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

                  {/* 3. URL */}
                  <span className="pad-url" style={{ color: normalTextColor, wordBreak: 'break-all' }}>
                    {window.location.origin}/{pad.id}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
