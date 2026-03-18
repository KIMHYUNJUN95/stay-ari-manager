import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../contexts/UserContext';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const UNIFIED_SYNC_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/unifiedSync";
const QUICK_SYNC_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/syncBeds24";

const styles = `
  .sync-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(6px);
    z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .sync-modal {
    background: #fff;
    border-radius: 20px;
    width: 100%; max-width: 480px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .sync-modal-header {
    background: linear-gradient(135deg, #1E293B 0%, #334155 100%);
    padding: 28px 28px 24px;
    position: relative;
  }
  .sync-modal-title {
    font-size: 20px; font-weight: 700;
    color: #fff; margin: 0 0 4px;
    letter-spacing: -0.3px;
  }
  .sync-modal-subtitle {
    font-size: 13px; color: rgba(255,255,255,0.6);
    margin: 0;
  }
  .sync-modal-close {
    position: absolute; top: 20px; right: 20px;
    background: rgba(255,255,255,0.12);
    border: none; border-radius: 50%;
    width: 32px; height: 32px;
    color: #fff; font-size: 18px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.2s;
  }
  .sync-modal-close:hover { background: rgba(255,255,255,0.22); }
  .sync-modal-body { padding: 24px 28px 28px; }

  .sync-section-label {
    font-size: 12px; font-weight: 600;
    color: #94A3B8; text-transform: uppercase;
    letter-spacing: 0.8px; margin-bottom: 8px;
  }
  .sync-option-card {
    border: 1.5px solid #E2E8F0;
    border-radius: 12px; padding: 16px;
    cursor: pointer; transition: all 0.2s;
    margin-bottom: 10px;
  }
  .sync-option-card:hover { border-color: #4F46E5; background: #F8F7FF; }
  .sync-option-card.selected {
    border-color: #4F46E5;
    background: linear-gradient(135deg, #F8F7FF 0%, #EEF2FF 100%);
  }
  .sync-option-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 4px;
  }
  .sync-option-icon {
    width: 32px; height: 32px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
  }
  .sync-option-name {
    font-size: 14px; font-weight: 600; color: #1E293B;
  }
  .sync-option-desc {
    font-size: 12px; color: #64748B; margin-left: 42px;
    line-height: 1.5;
  }
  .sync-radio {
    margin-left: auto;
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #CBD5E1;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .sync-radio.checked {
    border-color: #4F46E5;
    background: #4F46E5;
  }
  .sync-radio.checked::after {
    content: ''; width: 6px; height: 6px;
    background: #fff; border-radius: 50%;
  }

  .sync-date-picker-wrap {
    margin-top: 16px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .sync-date-input {
    width: 100%; padding: 10px 14px;
    border: 1.5px solid #E2E8F0; border-radius: 10px;
    font-size: 14px; color: #1E293B;
    outline: none; transition: border 0.2s;
    background: #F8FAFC;
    box-sizing: border-box;
  }
  .sync-date-input:focus { border-color: #4F46E5; background: #fff; }

  .sync-date-dropdowns {
    display: flex; gap: 8px;
  }
  .sync-date-select {
    flex: 1; padding: 10px 8px;
    border: 1.5px solid #E2E8F0; border-radius: 10px;
    font-size: 14px; color: #1E293B;
    outline: none; transition: border 0.2s;
    background: #F8FAFC;
    cursor: pointer; appearance: none;
    text-align: center;
  }
  .sync-date-select:focus { border-color: #4F46E5; background: #fff; }
  .sync-date-select-year { flex: 1.4; }

  .sync-info-box {
    background: #F0FDF4; border: 1px solid #BBF7D0;
    border-radius: 10px; padding: 12px 14px;
    font-size: 12px; color: #166534;
    margin-top: 14px; line-height: 1.6;
  }
  .sync-warn-box {
    background: #FFF7ED; border: 1px solid #FED7AA;
    border-radius: 10px; padding: 12px 14px;
    font-size: 12px; color: #9A3412;
    margin-top: 10px; line-height: 1.6;
  }

  .sync-btn-primary {
    width: 100%; padding: 14px;
    background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);
    color: #fff; border: none; border-radius: 12px;
    font-size: 15px; font-weight: 600;
    cursor: pointer; transition: all 0.2s;
    margin-top: 20px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    letter-spacing: -0.2px;
    box-shadow: 0 4px 14px rgba(79,70,229,0.3);
  }
  .sync-btn-primary:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(79,70,229,0.4);
  }
  .sync-btn-primary:disabled {
    opacity: 0.6; cursor: not-allowed; transform: none;
  }

  .sync-result-box {
    background: #F0FDF4; border: 1px solid #86EFAC;
    border-radius: 12px; padding: 16px;
    margin-top: 16px;
  }
  .sync-result-title {
    font-size: 14px; font-weight: 700; color: #166534;
    margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
  }
  .sync-result-row {
    font-size: 13px; color: #166534;
    display: flex; justify-content: space-between;
    padding: 3px 0;
  }
  .sync-progress-bar {
    height: 4px; background: #E2E8F0; border-radius: 4px;
    margin-top: 16px; overflow: hidden;
  }
  .sync-progress-fill {
    height: 100%; background: linear-gradient(90deg, #4F46E5, #818CF8);
    border-radius: 4px; transition: width 0.3s;
    animation: progressPulse 1.5s ease-in-out infinite;
  }
  @keyframes progressPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @media (max-width: 768px) {
    .sync-modal { border-radius: 16px; }
    .sync-modal-header { padding: 22px 20px 18px; }
    .sync-modal-body { padding: 20px; }
  }
`;

const TODAY = new Date();
const YEARS = Array.from({ length: TODAY.getFullYear() - 2020 + 3 }, (_, i) => 2021 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const getDaysInMonth = (y, m) => new Date(y, m, 0).getDate();

function parseDateStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { year: y, month: m, day: d };
}
function toDateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function DateDropdown({ label, value, onChange }) {
  const { year, month, day } = parseDateStr(value);
  const days = Array.from({ length: getDaysInMonth(year, month) }, (_, i) => i + 1);

  const update = (y, m, d) => {
    const maxDay = getDaysInMonth(y, m);
    onChange(toDateStr(y, m, Math.min(d, maxDay)));
  };

  return (
    <div>
      <div className="sync-section-label" style={{ marginTop: 10 }}>{label}</div>
      <div className="sync-date-dropdowns">
        <select className="sync-date-select sync-date-select-year" value={year}
          onChange={e => update(Number(e.target.value), month, day)}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="sync-date-select" value={month}
          onChange={e => update(year, Number(e.target.value), day)}>
          {MONTHS.map(m => <option key={m} value={m}>{`${String(m).padStart(2,'0')} · ${'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',')[m-1]}`}</option>)}
        </select>
        <select className="sync-date-select" value={day}
          onChange={e => update(year, month, Number(e.target.value))}>
          {days.map(d => <option key={d} value={d}>Day {d}</option>)}
        </select>
      </div>
    </div>
  );
}

export default function SyncManager({ isOpen, onClose, onSyncComplete }) {
  const { companyId } = useUser();
  const [mode, setMode] = useState('quick'); // 'quick' | 'unified'
  const [fromDate, setFromDate] = useState('2023-01-01');
  const [toDate, setToDate] = useState(new Date().toISOString().split('T')[0]);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Medium });

    setSyncing(true);
    setResult(null);
    setError(null);

    try {
      if (mode === 'quick') {
        const res = await fetch(QUICK_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Sync failed');
        setResult({ type: 'quick', upserted: data.upsertedCount });
      } else {
        const res = await fetch(UNIFIED_SYNC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId, fromDate, toDate })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Sync failed');
        setResult({
          type: 'unified',
          reservations: data.reservations?.upserted || 0,
          reviews: data.reviews?.inserted || 0
        });
      }
      if (onSyncComplete) onSyncComplete();
    } catch (err) {
      setError(err.message);
    }
    setSyncing(false);
  };

  const handleClose = () => {
    if (syncing) return;
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <>
      <style>{styles}</style>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="sync-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          >
            <motion.div
              className="sync-modal"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="sync-modal-header">
                <p className="sync-modal-title">Data Sync</p>
                <p className="sync-modal-subtitle">Select sync mode — Beds24 → Firestore</p>
                <button className="sync-modal-close" onClick={handleClose}>×</button>
              </div>

              <div className="sync-modal-body">
                <div className="sync-section-label">Sync Mode</div>

                {/* Quick Sync */}
                <div
                  className={`sync-option-card ${mode === 'quick' ? 'selected' : ''}`}
                  onClick={() => setMode('quick')}
                >
                  <div className="sync-option-header">
                    <div className="sync-option-icon" style={{ background: '#EEF2FF' }}>⚡</div>
                    <span className="sync-option-name">Quick Sync</span>
                    <div className={`sync-radio ${mode === 'quick' ? 'checked' : ''}`} />
                  </div>
                  <div className="sync-option-desc">
                    Updates only recently changed reservations · ~5–20 sec
                  </div>
                </div>

                {/* Full Sync */}
                <div
                  className={`sync-option-card ${mode === 'unified' ? 'selected' : ''}`}
                  onClick={() => setMode('unified')}
                >
                  <div className="sync-option-header">
                    <div className="sync-option-icon" style={{ background: '#FFF7ED' }}>🗄️</div>
                    <span className="sync-option-name">Full Sync</span>
                    <div className={`sync-radio ${mode === 'unified' ? 'checked' : ''}`} />
                  </div>
                  <div className="sync-option-desc">
                    Reservations + Reviews · Adds only new data · Custom date range
                  </div>
                </div>

                {/* Full Sync date picker */}
                <AnimatePresence>
                  {mode === 'unified' && (
                    <motion.div
                      className="sync-date-picker-wrap"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <DateDropdown label="Start Date" value={fromDate} onChange={setFromDate} />
                      <DateDropdown label="End Date" value={toDate} onChange={setToDate} />
                      <div className="sync-info-box">
                        ✅ Existing data in DB will not be overwritten<br />
                        ✅ Only new reservations & reviews in range will be added<br />
                        ✅ For old data (2021–2022), sync in 3-month chunks
                      </div>
                      <div className="sync-warn-box">
                        ⏱ Longer date ranges may take up to 5–10 minutes
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* 진행 중 */}
                {syncing && (
                  <div className="sync-progress-bar" style={{ marginTop: 20 }}>
                    <div className="sync-progress-fill" style={{ width: '100%' }} />
                  </div>
                )}

                {/* 결과 */}
                {result && (
                  <motion.div
                    className="sync-result-box"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="sync-result-title">✅ Sync Complete</div>
                    {result.type === 'quick' && (
                      <div className="sync-result-row">
                        <span>Reservations updated</span>
                        <strong>{result.upserted}</strong>
                      </div>
                    )}
                    {result.type === 'unified' && (
                      <>
                        <div className="sync-result-row">
                          <span>New reservations</span>
                          <strong>{result.reservations}</strong>
                        </div>
                        <div className="sync-result-row">
                          <span>New reviews</span>
                          <strong>{result.reviews}</strong>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}

                {/* 에러 */}
                {error && (
                  <div className="sync-warn-box" style={{ marginTop: 16 }}>
                    ❌ {error}
                  </div>
                )}

                <button
                  className="sync-btn-primary"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <>
                      <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                      Syncing...
                    </>
                  ) : (
                    <>🔄 Start Sync</>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
