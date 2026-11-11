'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LiveAgent } from '@/lib/team';

/** Warna aksen per jabatan (identitas visual tiap karyawan AI). */
const ACCENT: Record<string, string> = {
  SUPERVISOR: '#e0a526',
  ADS_MANAGER: '#5b8def',
  MEDIA_BUYER: '#2fb38a',
  ADS_ANALYST: '#8a6cf0',
  TRACKING_SPECIALIST: '#18a7c9',
  FRAUD_ANALYST: '#e05a4f',
  CREATIVE_SPECIALIST: '#e07fb4',
  LANDING_PAGE_SPECIALIST: '#f08a3c',
  AUTOMATION_SPECIALIST: '#7f8c99',
};

const STATE_EYE: Record<LiveAgent['state'], string> = {
  idle: '#7dd3fc',
  meeting: '#a5b4fc',
  working: '#4ade80',
  talking: '#facc15',
  off: '#3f3f46',
  paused: '#ef4444',
};

export const STATE_LABEL: Record<LiveAgent['state'], string> = {
  idle: 'Siaga',
  meeting: 'Ikut sesi',
  working: 'Mengambil data',
  talking: 'Menulis',
  off: 'Nonaktif',
  paused: 'Dihentikan',
};

/** Warna token CSS (bisa oklch) → THREE.Color lewat canvas 1×1. */
function cssColor(varName: string, fallback: string): THREE.Color {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!v) return new THREE.Color(fallback);
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = fallback;
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return new THREE.Color(r / 255, g / 255, b / 255);
  } catch {
    return new THREE.Color(fallback);
  }
}

interface Robot {
  id: string;
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  eyes: THREE.MeshStandardMaterial;
  antenna: THREE.MeshStandardMaterial;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  screen: THREE.MeshStandardMaterial | null;
  shell: THREE.MeshStandardMaterial;
  base: THREE.Vector3;
  phase: number;
}

function buildRobot(accentHex: string, supervisor: boolean): Omit<Robot, 'id' | 'base' | 'phase' | 'screen'> {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const accent = new THREE.Color(accentHex);
  const shell = new THREE.MeshStandardMaterial({ color: new THREE.Color('#e9edf2'), roughness: 0.45, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16191d', roughness: 0.3, metalness: 0.4 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.38, 6, 16), shell);
  torso.position.y = 0.72;
  torso.castShadow = true;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24), trim);
  chest.rotation.x = Math.PI / 2;
  chest.position.set(0, 0.78, 0.31);
  body.add(chest);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 32), trim);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.52;
  body.add(belt);

  const arm = (side: number) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 10), shell);
    m.geometry.translate(0, -0.2, 0);
    m.position.set(0.42 * side, 0.95, 0);
    m.castShadow = true;
    body.add(m);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), trim);
    hand.position.y = -0.44;
    m.add(hand);
    return m;
  };
  const armL = arm(-1);
  const armR = arm(1);

  const head = new THREE.Group();
  head.position.y = 1.32;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 0.5, 2, 2, 2), shell);
  skull.castShadow = true;
  head.add(skull);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.04), dark);
  visor.position.set(0, 0.01, 0.255);
  head.add(visor);
  const eyes = new THREE.MeshStandardMaterial({ color: '#7dd3fc', emissive: new THREE.Color('#7dd3fc'), emissiveIntensity: 1.6 });
  for (const x of [-0.12, 0.12]) {
    const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.05, 4, 8), eyes);
    e.rotation.z = Math.PI / 2;
    e.position.set(x, 0.01, 0.28);
    head.add(e);
  }
  for (const x of [-0.33, 0.33]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), trim);
    ear.rotation.z = Math.PI / 2;
    ear.position.x = x;
    head.add(ear);
  }
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), dark);
  stalk.position.y = 0.34;
  head.add(stalk);
  const antenna = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.6 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), antenna);
  bulb.position.y = 0.46;
  head.add(bulb);

  if (supervisor) {
    // Kepala Tim: mahkota/visor emas dan bahu lebih lebar.
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 24), trim);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 0.28;
    head.add(crown);
    group.scale.setScalar(1.18);
  }
  return { group, body, head, eyes, antenna, armL, armR, shell };
}

function buildDesk(accentHex: string) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.7 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.6), wood);
  top.position.y = 0.62;
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);
  for (const [x, z] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), wood);
    leg.position.set(x, 0.3, z);
    g.add(leg);
  }
  const screen = new THREE.MeshStandardMaterial({ color: '#0b1220', emissive: new THREE.Color(accentHex), emissiveIntensity: 0.25 });
  const mon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.03), screen);
  mon.position.set(0, 0.92, -0.18);
  mon.rotation.x = -0.08;
  g.add(mon);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), wood);
  stand.position.set(0, 0.72, -0.2);
  g.add(stand);
  return { desk: g, screen };
}

export interface OfficeProps {
  agents: LiveAgent[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}

/** Kantor 3D Tim AI: Kepala Tim di tengah, 8 karyawan AI di meja masing-masing; animasi mengikuti status nyata. */
export default function Office3D({ agents, selectedId, onSelect, height = 420 }: OfficeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const agentsRef = useRef(agents);
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const [failed, setFailed] = useState(false);
  agentsRef.current = agents;
  selectRef.current = onSelect;
  selectedRef.current = selectedId;

  const ids = agents.map((a) => a.id).join(',');

  useEffect(() => {
    const mount = mountRef.current;
    const labels = labelsRef.current;
    if (!mount || !labels) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 5.2, 9.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0.4);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minDistance = 6;
    controls.maxDistance = 22;
    controls.minPolarAngle = 0.5;
    controls.maxPolarAngle = 1.35;
    controls.update();

    scene.add(new THREE.HemisphereLight('#ffffff', '#64748b', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 8, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    scene.add(sun);

    const floorColor = cssColor('--color-surface-2', '#eef1f4');
    const ringColor = cssColor('--color-primary', '#1f6f8b');
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6.2, 64), new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.12, 64), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.55 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.01, -1.6);
    scene.add(ring);
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.05, 0.14, 48), new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.6 }));
    stage.position.set(0, 0.07, -1.6);
    stage.receiveShadow = true;
    scene.add(stage);

    // Susun: Kepala Tim di panggung belakang, karyawan di busur depan.
    const list = agentsRef.current;
    const workers = list.filter((a) => a.role === 'WORKER');
    const robots: Robot[] = [];
    const pickables: THREE.Object3D[] = [];
    list.forEach((a) => {
      const sup = a.role === 'SUPERVISOR';
      const accent = ACCENT[a.position ?? (sup ? 'SUPERVISOR' : '')] ?? '#64748b';
      const r = buildRobot(accent, sup);
      let base: THREE.Vector3;
      let screen: THREE.MeshStandardMaterial | null = null;
      if (sup) {
        base = new THREE.Vector3(0, 0.14, -1.6);
        r.group.rotation.y = 0;
      } else {
        const i = workers.indexOf(a);
        const n = workers.length;
        const ang = (-Math.PI * 0.42 + (i / Math.max(1, n - 1)) * Math.PI * 0.84);
        const radius = 4.1;
        base = new THREE.Vector3(Math.sin(ang) * radius, 0, Math.cos(ang) * radius - 1.2);
        // Menghadap ke depan (ke arah penonton) dengan sedikit condong ke tengah, meja di depannya.
        r.group.rotation.y = Math.atan2(-base.x * 0.35, 9 - base.z);
        const d = buildDesk(accent);
        d.desk.position.copy(base);
        d.desk.rotation.y = r.group.rotation.y;
        d.desk.translateZ(0.62);
        scene.add(d.desk);
        screen = d.screen;
      }
      r.group.position.copy(base);
      r.group.userData.agentId = a.id;
      r.group.traverse((o) => {
        o.userData.agentId = a.id;
        if ((o as THREE.Mesh).isMesh) pickables.push(o);
      });
      scene.add(r.group);
      robots.push({ id: a.id, ...r, base, phase: Math.random() * Math.PI * 2, screen });
    });

    // Label HTML mengikuti posisi kepala robot.
    labels.innerHTML = '';
    const labelEls = new Map<string, HTMLDivElement>();
    for (const a of list) {
      const el = document.createElement('div');
      el.className = 'office-label';
      labels.appendChild(el);
      labelEls.set(a.id, el);
    }

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Layar sempit (ponsel): mundurkan kamera agar seluruh tim terlihat.
      const dist = w / h < 1 ? 19 : w / h < 1.6 ? 13.5 : 10.6;
      camera.position.sub(controls.target).setLength(dist).add(controls.target);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downAt = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // drag kamera, bukan klik
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      const id = hit?.object.userData.agentId as string | undefined;
      if (id) selectRef.current?.(id);
    };
    let hovering: string | null = null;
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      hovering = (ray.intersectObjects(pickables, false)[0]?.object.userData.agentId as string | undefined) ?? null;
      renderer.domElement.style.cursor = hovering ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    const eyeColor = new THREE.Color();
    const supRobot = robots.find((r) => list.find((a) => a.id === r.id)?.role === 'SUPERVISOR');
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(mount);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const t = clock.getElapsedTime();
      const amp = reduce ? 0.25 : 1;
      const live = new Map(agentsRef.current.map((a) => [a.id, a]));
      for (const r of robots) {
        const a = live.get(r.id);
        const state = a?.state ?? 'idle';
        const p = t + r.phase;
        eyeColor.set(STATE_EYE[state]);
        r.eyes.color.copy(eyeColor);
        r.eyes.emissive.copy(eyeColor);
        r.eyes.emissiveIntensity = state === 'off' ? 0.05 : 1.2 + (state === 'talking' ? Math.sin(p * 12) * 0.6 : 0);
        r.antenna.emissiveIntensity = state === 'working' ? 0.6 + Math.abs(Math.sin(p * 8)) * 2 : state === 'paused' ? 1.5 + Math.sin(p * 4) : 0.5;
        r.shell.color.set(state === 'off' ? '#9aa1a9' : '#e9edf2');
        const bob = state === 'off' ? -0.12 : Math.sin(p * 1.6) * 0.03 * amp;
        r.body.position.y = bob;
        // Lengan: mengetik saat mengambil data, gestur saat menulis, diam saat siaga.
        if (state === 'working') {
          r.armL.rotation.x = -1.1 + Math.sin(p * 14) * 0.18 * amp;
          r.armR.rotation.x = -1.1 + Math.cos(p * 14) * 0.18 * amp;
        } else if (state === 'talking') {
          r.armL.rotation.x = -0.2;
          r.armR.rotation.x = -0.9 + Math.sin(p * 3) * 0.35 * amp;
        } else {
          r.armL.rotation.x += (0 - r.armL.rotation.x) * 0.1;
          r.armR.rotation.x += (0 - r.armR.rotation.x) * 0.1;
        }
        r.head.rotation.x = state === 'talking' ? Math.sin(p * 5) * 0.08 * amp : state === 'off' ? 0.35 : state === 'working' ? 0.18 : 0;
        r.head.rotation.y = state === 'idle' ? Math.sin(p * 0.5) * 0.25 * amp : 0;
        if (r.screen) {
          r.screen.emissiveIntensity = state === 'working' ? 0.6 + Math.abs(Math.sin(p * 9)) * 0.6 : state === 'off' ? 0.02 : 0.25;
        }
        // Peserta sesi menoleh ke Kepala Tim.
        if (supRobot && r !== supRobot && (state === 'meeting' || state === 'talking')) {
          r.head.rotation.y = Math.sin(p * 0.7) * 0.06;
        }
        const sel = selectedRef.current === r.id || hovering === r.id;
        r.group.scale.setScalar((list.find((x) => x.id === r.id)?.role === 'SUPERVISOR' ? 1.18 : 1) * (sel ? 1.06 : 1));

        // Label
        const el = labelEls.get(r.id);
        if (el && a) {
          tmp.copy(r.base).add(new THREE.Vector3(0, a.role === 'SUPERVISOR' ? 2.35 : 2.05, 0));
          tmp.project(camera);
          const x = (tmp.x * 0.5 + 0.5) * mount.clientWidth;
          const y = (-tmp.y * 0.5 + 0.5) * mount.clientHeight;
          el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
          el.style.opacity = tmp.z > 1 ? '0' : '1';
          const bubble = (state === 'talking' || state === 'working') && a.activity ? `<span class="office-bubble">${escapeHtml(a.activity)}</span>` : '';
          const html = `${bubble}<span class="office-name${sel ? ' is-sel' : ''}"><i style="background:${STATE_EYE[state]}"></i>${escapeHtml(a.name)}</span>`;
          if (el.dataset.html !== html) {
            el.innerHTML = html;
            el.dataset.html = html;
          }
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      labels.innerHTML = '';
    };
    // Scene dibangun ulang hanya bila susunan agent berubah; status dibaca per frame dari ref.
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <p className="py-10 text-center text-[13px] text-muted">Browser ini tidak mendukung WebGL; gunakan tampilan struktur.</p>;
  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <div ref={mountRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" aria-hidden />
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
