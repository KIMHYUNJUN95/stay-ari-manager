import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useUser } from "../contexts/UserContext";
import { ROOM_LINKS as BASE_ROOM_LINKS } from "../constants/roomLinks";
import { BUILDING_NAMES_EN as _BUILDING_NAMES_EN } from '../constants/buildingData';

// -----------------------------------------------------------------------------
// [CONSTANTS & LOGIC] Data Management (Preserved)
// -----------------------------------------------------------------------------
const LS_KEY = "ROOM_LINKS_DATA_v2";
const OLD_LS_KEY = "ROOM_LINKS_OVERRIDES_v1";
const FIRESTORE_COLLECTION = "roomLinks";
const BUILDING_NAMES_EN = {
  ..._BUILDING_NAMES_EN,
  "아라키초AA": "Arakicho AA",
  "가부키초K": "Kabukicho K",
  "가부키초KK": "Kabukicho KK"
};
const BUILDING_DISPLAY_ORDER = [
  "Arakicho A",
  "Arakicho AA",
  "Arakicho B",
  "Kabukicho",
  "Kabukicho K",
  "Kabukicho KK",
  "Takadanobaba",
  "Okubo A",
  "Okubo B",
  "Okubo C",
  "Sano",
  "Daikyocho"
];
const BUILDING_DISPLAY_ORDER_INDEX = BUILDING_DISPLAY_ORDER.reduce((acc, label, index) => {
  acc[label] = index;
  return acc;
}, {});

function getBuildingLabel(buildingName) {
  return BUILDING_NAMES_EN[buildingName] || buildingName;
}

function compareBuildingNames(a, b) {
  const aLabel = getBuildingLabel(a);
  const bLabel = getBuildingLabel(b);
  const aIndex = BUILDING_DISPLAY_ORDER_INDEX[aLabel];
  const bIndex = BUILDING_DISPLAY_ORDER_INDEX[bLabel];
  const aRank = aIndex === undefined ? Number.MAX_SAFE_INTEGER : aIndex;
  const bRank = bIndex === undefined ? Number.MAX_SAFE_INTEGER : bIndex;

  if (aRank !== bRank) return aRank - bRank;
  return aLabel.localeCompare(bLabel);
}

function createEmptyBuildingOrder() {
  return { airbnb: [], booking: [] };
}

function normalizeBuildingOrder(orderList, platformData) {
  const keys = Object.keys(platformData || {});
  const seen = new Set();
  const ordered = [];

  if (Array.isArray(orderList)) {
    orderList.forEach((key) => {
      if (keys.includes(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    });
  }

  const remaining = keys.filter((key) => !seen.has(key)).sort(compareBuildingNames);
  return [...ordered, ...remaining];
}

function normalizeDataShape(rawData) {
  const airbnbData = rawData?.airbnb && typeof rawData.airbnb === "object" ? splitKabukicho(rawData.airbnb) : {};
  const bookingData = rawData?.booking && typeof rawData.booking === "object" ? rawData.booking : {};
  const buildingOrder = rawData?.buildingOrder && typeof rawData.buildingOrder === "object"
    ? rawData.buildingOrder
    : createEmptyBuildingOrder();

  return {
    airbnb: airbnbData,
    booking: bookingData,
    buildingOrder: {
      airbnb: normalizeBuildingOrder(buildingOrder.airbnb, airbnbData),
      booking: normalizeBuildingOrder(buildingOrder.booking, bookingData)
    }
  };
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return "";
  }
}

function mergeOldData(base, overrides) {
  const result = JSON.parse(JSON.stringify(base || {}));
  const o = overrides || {};
  Object.keys(o).forEach((building) => {
    result[building] = result[building] || {};
    Object.keys(o[building] || {}).forEach((room) => {
      result[building][room] = { ...(result[building][room] || {}), ...(o[building][room] || {}) };
    });
  });
  return result;
}

function splitKabukicho(data) {
  const result = { ...data };
  if (result["가부키초"]) {
    const kabukicho = result["가부키초"];
    const kRooms = {};
    const kkRooms = {};
    Object.keys(kabukicho).forEach(roomKey => {
      const key = String(roomKey);
      if (key.startsWith("KK") || key.startsWith("Kk")) {
        kkRooms[roomKey] = kabukicho[roomKey];
      } else {
        kRooms[roomKey] = kabukicho[roomKey];
      }
    });
    delete result["가부키초"];
    if (Object.keys(kRooms).length > 0) result["가부키초K"] = kRooms;
    if (Object.keys(kkRooms).length > 0) result["가부키초KK"] = kkRooms;
  }
  return result;
}

function loadData() {
  let savedAirbnb = null;
  let savedBooking = null;
  let savedBuildingOrder = null;

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        savedAirbnb = parsed.airbnb && typeof parsed.airbnb === "object" ? parsed.airbnb : null;
        savedBooking = parsed.booking && typeof parsed.booking === "object" ? parsed.booking : null;
        savedBuildingOrder = parsed.buildingOrder && typeof parsed.buildingOrder === "object" ? parsed.buildingOrder : null;
      }
    }
  } catch (e) {
    console.warn("Room Links load parse error:", e);
  }

  if (savedAirbnb && Object.keys(savedAirbnb).length > 0) {
    const normalizedData = normalizeDataShape({
      airbnb: savedAirbnb,
      booking: savedBooking || {},
      buildingOrder: savedBuildingOrder || createEmptyBuildingOrder()
    });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(normalizedData));
    } catch (e) {
      console.warn("Room Links save after split failed:", e);
    }
    return normalizedData;
  }

  try {
    let existingBooking = savedBooking || {};
    let oldOverrides = {};
    try {
      const oldRaw = localStorage.getItem(OLD_LS_KEY);
      if (oldRaw) oldOverrides = JSON.parse(oldRaw);
    } catch { }

    const mergedAirbnb = mergeOldData(BASE_ROOM_LINKS, oldOverrides);
    const newData = normalizeDataShape({
      airbnb: mergedAirbnb,
      booking: existingBooking,
      buildingOrder: createEmptyBuildingOrder()
    });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(newData));
    } catch (e) {
      console.warn("Room Links migration save failed:", e);
    }
    return newData;
  } catch (e) {
    console.error("Room Links migration failed:", e);
  }

  return normalizeDataShape({
    airbnb: BASE_ROOM_LINKS,
    booking: {},
    buildingOrder: createEmptyBuildingOrder()
  });
}

function saveDataLocal(data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Room Links localStorage save failed:", e);
    return false;
  }
}

async function saveDataToFirestore(companyId, data) {
  if (!companyId) return true;
  try {
    await setDoc(doc(db, FIRESTORE_COLLECTION, companyId), {
      airbnb: data.airbnb || {},
      booking: data.booking || {},
      buildingOrder: data.buildingOrder || createEmptyBuildingOrder(),
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (e) {
    console.error("Room Links Firestore save failed:", e);
    return false;
  }
}

// -----------------------------------------------------------------------------
// [COMPONENT] RoomLinksDashboard (Haru Studio Theme)
// -----------------------------------------------------------------------------

export default function RoomLinksDashboard() {
  const { companyId } = useUser();
  const [data, setData] = useState(loadData);
  const [platform, setPlatform] = useState("airbnb"); // airbnb, booking
  const [selectedBuilding, setSelectedBuilding] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [, setLoadFromFirestoreDone] = useState(false);

  // Modal States
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [showRenameBuilding, setShowRenameBuilding] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newBuildingName, setNewBuildingName] = useState("");
  const [editBuildingName, setEditBuildingName] = useState("");
  const [newRoomName, setNewRoomName] = useState("");
  const [newHostUrl, setNewHostUrl] = useState("");
  const [newGuestUrl, setNewGuestUrl] = useState("");

  // Edit States
  const [editingRoom, setEditingRoom] = useState(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [editHost, setEditHost] = useState("");
  const [editGuest, setEditGuest] = useState("");
  const [draggingBuilding, setDraggingBuilding] = useState("");
  const [savedTick, setSavedTick] = useState(0);

  // 팀 공용: Firestore에서 불러오기 (companyId 기준). 없으면 로컬 데이터를 Firestore에 올려 팀과 공유
  useEffect(() => {
    if (!companyId) {
      setLoadFromFirestoreDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const ref = doc(db, FIRESTORE_COLLECTION, companyId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (snap.exists()) {
          const remoteData = normalizeDataShape(snap.data());
          if (Object.keys(remoteData.airbnb).length > 0 || Object.keys(remoteData.booking).length > 0) {
            setData(remoteData);
          } else {
            const local = loadData();
            if (local.airbnb && Object.keys(local.airbnb).length > 0) {
              await saveDataToFirestore(companyId, local);
            }
          }
        } else {
          const local = loadData();
          if (local.airbnb && Object.keys(local.airbnb).length > 0) {
            await saveDataToFirestore(companyId, local);
          }
        }
      } catch (e) {
        console.warn("Room Links Firestore load failed:", e);
      }
      setLoadFromFirestoreDone(true);
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const buildings = useMemo(() => {
    return normalizeBuildingOrder(data.buildingOrder?.[platform], data[platform]);
  }, [data, platform]);

  useEffect(() => {
    if (buildings.length > 0 && (!selectedBuilding || !buildings.includes(selectedBuilding))) {
      setSelectedBuilding(buildings[0]);
    } else if (buildings.length === 0) {
      setSelectedBuilding("");
    }
  }, [buildings, selectedBuilding]);

  const extractNumber = (str) => {
    const match = String(str).match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  const rooms = useMemo(() => {
    if (!selectedBuilding || !data[platform]?.[selectedBuilding]) return [];
    const roomObj = data[platform][selectedBuilding];
    let keys = Object.keys(roomObj);

    const f = roomFilter.trim().toLowerCase();
    if (f) {
      keys = keys.filter(r => r.toLowerCase().includes(f));
    }
    return keys.sort((a, b) => extractNumber(a) - extractNumber(b));
  }, [data, platform, selectedBuilding, roomFilter]);

  const moveArrayItem = (items, fromIndex, toIndex) => {
    const nextItems = [...items];
    const [movedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, movedItem);
    return nextItems;
  };

  const updateData = async (newData) => {
    const normalizedData = normalizeDataShape(newData);
    setData(normalizedData);
    saveDataLocal(normalizedData);
    const ok = await saveDataToFirestore(companyId, normalizedData);
    if (!ok) alert("Team save failed. Your links are saved on this device only. Check your connection.");
    setSavedTick(Date.now());
  };

  const addBuilding = () => {
    const name = newBuildingName.trim();
    if (!name) return alert("Please enter a property name.");
    if (data[platform]?.[name]) return alert("Property already exists.");

    const nextPlatform = { ...(data[platform] || {}), [name]: {} };
    const nextOrder = [...buildings, name];
    const newData = {
      ...data,
      [platform]: nextPlatform,
      buildingOrder: {
        ...(data.buildingOrder || createEmptyBuildingOrder()),
        [platform]: nextOrder
      }
    };
    updateData(newData);
    setSelectedBuilding(name);
    setNewBuildingName("");
    setShowAddBuilding(false);
  };

  const openRenameBuilding = () => {
    if (!selectedBuilding) return;
    setEditBuildingName(selectedBuilding);
    setShowRenameBuilding(true);
  };

  const closeRenameBuilding = () => {
    setShowRenameBuilding(false);
    setEditBuildingName("");
  };

  const renameBuilding = () => {
    const currentName = selectedBuilding;
    const nextName = editBuildingName.trim();

    if (!currentName) return alert("Please select a property first.");
    if (!nextName) return alert("Please enter a property name.");
    if (currentName === nextName) {
      closeRenameBuilding();
      return;
    }
    if (data[platform]?.[nextName]) return alert("Property already exists.");

    const currentPlatform = data[platform] || {};
    const renamedRooms = currentPlatform[currentName];
    if (!renamedRooms) return;

    const nextPlatform = {};
    Object.keys(currentPlatform).forEach((buildingName) => {
      if (buildingName === currentName) {
        nextPlatform[nextName] = renamedRooms;
        return;
      }
      nextPlatform[buildingName] = currentPlatform[buildingName];
    });

    const nextOrder = buildings.map((buildingName) => (
      buildingName === currentName ? nextName : buildingName
    ));
    const newData = {
      ...data,
      [platform]: nextPlatform,
      buildingOrder: {
        ...(data.buildingOrder || createEmptyBuildingOrder()),
        [platform]: nextOrder
      }
    };
    updateData(newData);
    setSelectedBuilding(nextName);
    closeRenameBuilding();
  };

  const deleteBuilding = (buildingName) => {
    if (!window.confirm(`Delete property "${buildingName}" and all its rooms?`)) return;
    const nextPlatform = { ...(data[platform] || {}) };
    delete nextPlatform[buildingName];
    const nextOrder = buildings.filter((name) => name !== buildingName);
    const newData = {
      ...data,
      [platform]: nextPlatform,
      buildingOrder: {
        ...(data.buildingOrder || createEmptyBuildingOrder()),
        [platform]: nextOrder
      }
    };
    updateData(newData);
  };

  const reorderBuildings = (fromIndex, toIndex) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || toIndex >= buildings.length) return;
    const nextOrder = moveArrayItem(buildings, fromIndex, toIndex);
    const newData = {
      ...data,
      buildingOrder: {
        ...(data.buildingOrder || createEmptyBuildingOrder()),
        [platform]: nextOrder
      }
    };
    updateData(newData);
  };

  const moveBuilding = (buildingName, direction) => {
    const currentIndex = buildings.indexOf(buildingName);
    if (currentIndex === -1) return;
    reorderBuildings(currentIndex, currentIndex + direction);
  };

  const handleBuildingDragStart = (event, buildingName) => {
    setDraggingBuilding(buildingName);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", buildingName);
    }
  };

  const handleBuildingDragOver = (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };

  const handleBuildingDrop = (event, targetBuilding) => {
    event.preventDefault();
    if (!draggingBuilding || draggingBuilding === targetBuilding) {
      setDraggingBuilding("");
      return;
    }

    const fromIndex = buildings.indexOf(draggingBuilding);
    const toIndex = buildings.indexOf(targetBuilding);
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderBuildings(fromIndex, toIndex);
    }
    setDraggingBuilding("");
  };

  const handleBuildingDragEnd = () => {
    setDraggingBuilding("");
  };

  const addRoom = () => {
    const name = newRoomName.trim();
    if (!name) return alert("Please enter a room name.");
    if (!selectedBuilding) return alert("Please select a property first.");
    if (data[platform]?.[selectedBuilding]?.[name]) return alert("Room already exists.");

    const nextPlatform = {
      ...(data[platform] || {}),
      [selectedBuilding]: {
        ...(data[platform]?.[selectedBuilding] || {}),
        [name]: {
          host: newHostUrl.trim(),
          guest: newGuestUrl.trim()
        }
      }
    };
    const newData = { ...data, [platform]: nextPlatform };
    updateData(newData);
    setNewRoomName("");
    setNewHostUrl("");
    setNewGuestUrl("");
    setShowAddRoom(false);
  };

  const deleteRoom = (roomName) => {
    if (!window.confirm(`Delete room "${roomName}"?`)) return;
    const nextBuilding = { ...(data[platform]?.[selectedBuilding] || {}) };
    delete nextBuilding[roomName];
    const nextPlatform = { ...(data[platform] || {}), [selectedBuilding]: nextBuilding };
    const newData = { ...data, [platform]: nextPlatform };
    updateData(newData);
  };

  const startEdit = (roomName) => {
    const roomData = data[platform]?.[selectedBuilding]?.[roomName] || {};
    setEditingRoom(roomName);
    setEditRoomName(roomName);
    setEditHost(roomData.host || "");
    setEditGuest(roomData.guest || "");
  };

  const saveEdit = () => {
    if (!editingRoom || !selectedBuilding) return;
    const nextRoomName = editRoomName.trim();
    if (!nextRoomName) return alert("Please enter a room name.");

    const currentBuilding = data[platform]?.[selectedBuilding] || {};
    if (nextRoomName !== editingRoom && currentBuilding[nextRoomName]) return alert("Room already exists.");

    const nextBuilding = {};
    Object.keys(currentBuilding).forEach((roomName) => {
      if (roomName === editingRoom) {
        nextBuilding[nextRoomName] = { host: editHost.trim(), guest: editGuest.trim() };
        return;
      }
      nextBuilding[roomName] = currentBuilding[roomName];
    });
    const nextPlatform = { ...(data[platform] || {}), [selectedBuilding]: nextBuilding };
    const newData = { ...data, [platform]: nextPlatform };
    updateData(newData);
    setEditingRoom(null);
    setEditRoomName("");
    setEditHost("");
    setEditGuest("");
  };

  const cancelEdit = () => {
    setEditingRoom(null);
    setEditRoomName("");
    setEditHost("");
    setEditGuest("");
  };

  // Styles (Haru Studio Theme)
  const styles = {
    container: {
      padding: '32px',
      background: '#FFFFFF',
      minHeight: '100vh',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '32px',
      flexWrap: 'wrap',
      gap: '16px'
    },
    titleGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
    icon: {
      fontSize: '28px',
      background: '#EEF2FF',
      width: '48px',
      height: '48px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '12px',
      color: '#4F46E5'
    },
    title: { fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0, letterSpacing: '-0.5px' },
    subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px', fontWeight: '500' },

    // Platform Tabs
    tabGroup: { display: 'flex', gap: '4px', background: '#F1F5F9', padding: '4px', borderRadius: '12px', width: 'fit-content' },
    tab: (active) => ({
      padding: '8px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s',
      background: active ? '#FFFFFF' : 'transparent',
      color: active ? '#4F46E5' : '#64748B',
      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
    }),

    // Control Bar
    controls: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'center' },
    primaryBtn: {
      background: '#4F46E5', color: '#FFFFFF', padding: '10px 16px', borderRadius: '10px',
      border: 'none', fontWeight: '600', fontSize: '14px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: '6px'
    },
    select: {
      padding: '10px 14px', borderRadius: '10px', border: '1px solid #CBD5E1',
      fontSize: '14px', color: '#1E293B', outline: 'none', minWidth: '160px'
    },
    input: {
      padding: '10px 14px', borderRadius: '10px', border: '1px solid #CBD5E1',
      fontSize: '14px', color: '#1E293B', outline: 'none'
    },
    propertyPanel: {
      marginBottom: '24px',
      padding: '16px',
      borderRadius: '18px',
      border: '1px solid #E2E8F0',
      background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
      boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)'
    },
    propertyPanelHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
      marginBottom: '14px'
    },
    propertyPanelTitle: {
      fontSize: '15px',
      fontWeight: '700',
      color: '#0F172A'
    },
    propertyPanelHint: {
      fontSize: '12px',
      color: '#64748B',
      fontWeight: '600'
    },
    propertyList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxHeight: '320px',
      overflowY: 'auto'
    },
    propertyRow: (active, dragging) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 12px',
      borderRadius: '14px',
      border: active ? '1px solid #C7D2FE' : '1px solid #E2E8F0',
      background: active ? 'linear-gradient(180deg, #EEF2FF 0%, #F8FAFC 100%)' : '#FFFFFF',
      boxShadow: dragging
        ? '0 12px 24px rgba(79, 70, 229, 0.12)'
        : active
          ? '0 8px 18px rgba(79, 70, 229, 0.08)'
          : '0 2px 8px rgba(15, 23, 42, 0.04)',
      opacity: dragging ? 0.75 : 1,
      transition: 'all 0.2s ease'
    }),
    dragHandle: (active) => ({
      width: '34px',
      height: '34px',
      borderRadius: '10px',
      border: active ? '1px solid #C7D2FE' : '1px solid #CBD5E1',
      background: active ? '#FFFFFF' : '#F8FAFC',
      color: active ? '#4F46E5' : '#475569',
      fontSize: '12px',
      fontWeight: '700',
      cursor: 'grab',
      flexShrink: 0
    }),
    propertyNameBtn: (active) => ({
      flex: 1,
      border: 'none',
      background: 'transparent',
      textAlign: 'left',
      padding: 0,
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }),
    propertyName: (active) => ({
      fontSize: '14px',
      fontWeight: '700',
      color: active ? '#1E1B4B' : '#0F172A'
    }),
    propertyMeta: (active) => ({
      fontSize: '12px',
      color: active ? '#6366F1' : '#64748B'
    }),
    propertyMoveBtn: (active, disabled) => ({
      width: '34px',
      height: '34px',
      borderRadius: '10px',
      border: active ? '1px solid #C7D2FE' : '1px solid #CBD5E1',
      background: disabled ? '#F8FAFC' : '#FFFFFF',
      color: disabled ? '#CBD5E1' : active ? '#4F46E5' : '#475569',
      cursor: disabled ? 'not-allowed' : 'pointer',
      flexShrink: 0,
      boxShadow: active && !disabled ? '0 4px 10px rgba(79, 70, 229, 0.08)' : 'none'
    }),

    // Link Button Styles
    linkBtn: (type, disabled) => ({
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '6px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
      textDecoration: 'none', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: type === 'host' ? '#EEF2FF' : '#ECFDF5',
      color: type === 'host' ? '#4F46E5' : '#059669',
      border: 'none', transition: '0.2s'
    })
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.icon}>🔗</div>
          <div>
            <h1 style={styles.title}>Room Links</h1>
            <p style={styles.subtitle}>Manage Airbnb & Booking.com Direct Links</p>
          </div>
        </div>
        <div style={styles.tabGroup}>
          <button style={styles.tab(platform === "airbnb")} onClick={() => { setPlatform("airbnb"); setRoomFilter(""); cancelEdit(); }}>Airbnb</button>
          <button style={styles.tab(platform === "booking")} onClick={() => { setPlatform("booking"); setRoomFilter(""); cancelEdit(); }}>Booking.com</button>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <button style={styles.primaryBtn} onClick={() => setShowAddBuilding(true)}>
          <span>+ Add Property</span>
        </button>

        {buildings.length > 0 && (
          <>
            <button style={styles.primaryBtn} onClick={() => setShowAddRoom(true)}>
              <span>+ Add Room</span>
            </button>

            <button
              style={{ ...styles.primaryBtn, background: '#E2E8F0', color: '#1E293B' }}
              onClick={openRenameBuilding}
            >
              Rename Property
            </button>

            <input
              style={styles.input}
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              placeholder="Search room..."
            />

            {selectedBuilding && (
              <button
                onClick={() => deleteBuilding(selectedBuilding)}
                style={{ ...styles.primaryBtn, background: '#FEE2E2', color: '#EF4444' }}
              >
                Delete Property
              </button>
            )}
          </>
        )}
      </div>

      {buildings.length > 0 && (
        <div style={styles.propertyPanel}>
          <div style={styles.propertyPanelHeader}>
            <div style={styles.propertyPanelTitle}>Property Order</div>
            <div style={styles.propertyPanelHint}>Click to select, drag to move, or use up/down.</div>
          </div>

          <div style={styles.propertyList}>
            {buildings.map((buildingName, index) => {
              const active = selectedBuilding === buildingName;
              const roomCount = Object.keys(data[platform]?.[buildingName] || {}).length;
              const isDragging = draggingBuilding === buildingName;

              return (
                <div
                  key={buildingName}
                  style={styles.propertyRow(active, isDragging)}
                  draggable
                  onDragStart={(event) => handleBuildingDragStart(event, buildingName)}
                  onDragOver={handleBuildingDragOver}
                  onDrop={(event) => handleBuildingDrop(event, buildingName)}
                  onDragEnd={handleBuildingDragEnd}
                >
                  <button
                    type="button"
                    aria-label={`Drag ${getBuildingLabel(buildingName)}`}
                    style={styles.dragHandle(active)}
                  >
                    ::
                  </button>

                  <button
                    type="button"
                    style={styles.propertyNameBtn(active)}
                    onClick={() => {
                      setSelectedBuilding(buildingName);
                      cancelEdit();
                    }}
                  >
                    <span style={styles.propertyName(active)}>{getBuildingLabel(buildingName)}</span>
                    <span style={styles.propertyMeta(active)}>{roomCount} rooms</span>
                  </button>

                  <button
                    type="button"
                    aria-label={`Move ${getBuildingLabel(buildingName)} up`}
                    disabled={index === 0}
                    style={styles.propertyMoveBtn(active, index === 0)}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveBuilding(buildingName, -1);
                    }}
                  >
                    ^
                  </button>

                  <button
                    type="button"
                    aria-label={`Move ${getBuildingLabel(buildingName)} down`}
                    disabled={index === buildings.length - 1}
                    style={styles.propertyMoveBtn(active, index === buildings.length - 1)}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveBuilding(buildingName, 1);
                    }}
                  >
                    v
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="responsive-grid-container">
        {buildings.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px", background: "#F8FAFC", borderRadius: "16px", color: "#64748B" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>🏗️</div>
            <div>No properties found. Add a property to get started.</div>
          </div>
        ) : rooms.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px", background: "#F8FAFC", borderRadius: "16px", color: "#64748B" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>🚪</div>
            <div>No rooms found in this property.</div>
          </div>
        ) : (
          <div className="responsive-table-container">
            {/* PC Table View */}
            <table className="pc-table-view" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>ROOM</th>
                  <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>LINKS</th>
                  <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>URL DETAILS</th>
                  <th style={{ padding: '16px', textAlign: 'right', fontSize: '12px', fontWeight: '700', color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room, index) => {
                  const roomData = data[platform]?.[selectedBuilding]?.[room] || {};
                  const hostUrl = normalizeUrl(roomData.host);
                  const guestUrl = normalizeUrl(roomData.guest);
                  const isEditing = editingRoom === room;

                  return (
                    <tr key={room} style={{ background: index % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                      <td style={{ padding: '16px', fontWeight: '600', color: '#1E293B', borderBottom: '1px solid #F1F5F9' }}>
                        {isEditing ? (editRoomName || room?.replace('호', '')) : room?.replace('호', '')}
                      </td>
                      <td style={{ padding: '16px', borderBottom: '1px solid #F1F5F9' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <a href={hostUrl || '#'} target="_blank" rel="noopener noreferrer" style={styles.linkBtn('host', !hostUrl)}>Host Link</a>
                          <a href={guestUrl || '#'} target="_blank" rel="noopener noreferrer" style={styles.linkBtn('guest', !guestUrl)}>Guest Link</a>
                        </div>
                      </td>
                      <td style={{ padding: '16px', fontSize: '12px', color: '#94A3B8', borderBottom: '1px solid #F1F5F9', maxWidth: '300px' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <input placeholder="Room Name" value={editRoomName} onChange={(e) => setEditRoomName(e.target.value)} style={styles.input} />
                            <input placeholder="Host URL" value={editHost} onChange={(e) => setEditHost(e.target.value)} style={styles.input} />
                            <input placeholder="Guest URL" value={editGuest} onChange={(e) => setEditGuest(e.target.value)} style={styles.input} />
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={saveEdit} style={{ ...styles.primaryBtn, padding: '6px 12px', fontSize: '12px' }}>Save</button>
                              <button onClick={cancelEdit} style={{ ...styles.primaryBtn, background: '#F1F5F9', color: '#475569', padding: '6px 12px', fontSize: '12px' }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{}}>
                            <div title={hostUrl} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>H: {hostUrl || '-'}</div>
                            <div title={guestUrl} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>G: {guestUrl || '-'}</div>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', borderBottom: '1px solid #F1F5F9' }}>
                        {!isEditing && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button onClick={() => startEdit(room)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>✏️</button>
                            <button onClick={() => deleteRoom(room)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>🗑️</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile Card List */}
            <div className="mobile-card-list">
              {rooms.map((room) => {
                const roomData = data[platform]?.[selectedBuilding]?.[room] || {};
                const hostUrl = normalizeUrl(roomData.host);
                const guestUrl = normalizeUrl(roomData.guest);
                const isEditing = editingRoom === room;

                return (
                  <div key={room} className="mobile-card-item">
                    <div className="mobile-card-row" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: '12px', marginBottom: '12px' }}>
                      <span style={{ fontWeight: '700', color: '#1E293B' }}>{isEditing ? (editRoomName || room?.replace('호', '')) : room?.replace('호', '')}</span>
                      {!isEditing && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => startEdit(room)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>✏️</button>
                          <button onClick={() => deleteRoom(room)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>🗑️</button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B' }}>Room Name</label>
                          <input value={editRoomName} onChange={(e) => setEditRoomName(e.target.value)} style={{ ...styles.input, width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B' }}>Host URL</label>
                          <input value={editHost} onChange={(e) => setEditHost(e.target.value)} style={{ ...styles.input, width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B' }}>Guest URL</label>
                          <input value={editGuest} onChange={(e) => setEditGuest(e.target.value)} style={{ ...styles.input, width: '100%' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <button onClick={saveEdit} style={{ ...styles.primaryBtn, flex: 1, justifyContent: 'center' }}>Save</button>
                          <button onClick={cancelEdit} style={{ ...styles.primaryBtn, background: '#F1F5F9', color: '#475569', flex: 1, justifyContent: 'center' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <a href={hostUrl || '#'} target="_blank" rel="noopener noreferrer"
                          style={{ ...styles.linkBtn('host', !hostUrl), flex: 1, justifyContent: 'center', padding: '10px' }}>
                          Host Link
                        </a>
                        <a href={guestUrl || '#'} target="_blank" rel="noopener noreferrer"
                          style={{ ...styles.linkBtn('guest', !guestUrl), flex: 1, justifyContent: 'center', padding: '10px' }}>
                          Guest Link
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {savedTick > 0 && (
          <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', background: '#059669', color: 'white', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', animation: 'fadeIn 0.3s' }}>
            ✓ Changes Saved
          </div>
        )}
      </div>

      {/* Add Property Modal */}
      {showAddBuilding && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '16px', width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Add New Property</h3>
            <input
              style={{ ...styles.input, width: '100%', marginBottom: '16px' }}
              placeholder="Property Name (e.g., Arakicho)"
              value={newBuildingName} onChange={(e) => setNewBuildingName(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={{ ...styles.primaryBtn, flex: 1, justifyContent: 'center' }} onClick={addBuilding}>Add</button>
              <button style={{ ...styles.primaryBtn, background: '#F1F5F9', color: '#475569', flex: 1, justifyContent: 'center' }} onClick={() => setShowAddBuilding(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Property Modal */}
      {showRenameBuilding && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '16px', width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>Rename Property</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748B' }}>Current name: {selectedBuilding}</p>
            <input
              style={{ ...styles.input, width: '100%', marginBottom: '16px' }}
              placeholder="Property Name"
              value={editBuildingName}
              onChange={(e) => setEditBuildingName(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={{ ...styles.primaryBtn, flex: 1, justifyContent: 'center' }} onClick={renameBuilding}>Save</button>
              <button style={{ ...styles.primaryBtn, background: '#F1F5F9', color: '#475569', flex: 1, justifyContent: 'center' }} onClick={closeRenameBuilding}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Room Modal */}
      {showAddRoom && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '16px', width: '90%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Add Room to {selectedBuilding}</h3>

            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B', display: 'block', marginBottom: '4px' }}>Room Name</label>
            <input
              style={{ ...styles.input, width: '100%', marginBottom: '12px' }}
              placeholder="e.g., 201"
              value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)}
            />

            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B', display: 'block', marginBottom: '4px' }}>Host URL (Optional)</label>
            <input
              style={{ ...styles.input, width: '100%', marginBottom: '12px' }}
              placeholder="https://..."
              value={newHostUrl} onChange={(e) => setNewHostUrl(e.target.value)}
            />

            <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#64748B', display: 'block', marginBottom: '4px' }}>Guest URL (Optional)</label>
            <input
              style={{ ...styles.input, width: '100%', marginBottom: '20px' }}
              placeholder="https://..."
              value={newGuestUrl} onChange={(e) => setNewGuestUrl(e.target.value)}
            />

            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={{ ...styles.primaryBtn, flex: 1, justifyContent: 'center' }} onClick={addRoom}>Add Room</button>
              <button style={{ ...styles.primaryBtn, background: '#F1F5F9', color: '#475569', flex: 1, justifyContent: 'center' }} onClick={() => setShowAddRoom(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
