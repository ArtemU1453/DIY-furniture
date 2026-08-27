import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls, TransformControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { partWorldAABB, partBoxGeometry } from '@/core/geometry/partGeometry';
import { operationWorld } from '@/core/geometry/coordinateSystem';
import { allOperations } from '@/engines/machining';
import { overallDimensions, detectCollisions, validatePartChange } from '@/engines/viewer';
import type { MachiningId, MaterialId, PartId } from '@/core/model/ids';
import type { HardwareCategory, Material, Part, Project } from '@/core/model/types';
import { PartMesh } from './PartMesh';
import { ViewControls, type StandardView, VIEW_POSITIONS } from './ViewControls';

const MM_TO_UNIT = 1 / 1000;

/** Цвет глифа фурнитуры по категории крепежа. */
const HW_COLOR: Partial<Record<HardwareCategory, string>> = {
  confirmat: '#c9a227', dowel: '#b98a4a', minifix: '#8a9bb5', screw: '#9aa0a6',
  hinge: '#6cae75', slide: '#5f8dd3', handle: '#c77b53', leg: '#7a7f88', corner: '#b06a9a',
};

const UP = new THREE.Vector3(0, 1, 0);

/** Визуализация фурнитуры: цилиндрические глифы крепежа вдоль оси присадки. */
function HardwareLayer({ project, selectedId }: { project: Project; selectedId: string | null }) {
  const glyphs = useMemo(() => {
    const byConn = new Map<string, string>();
    for (const c of project.hardwareConnections) byConn.set(c.id, c.hardwareId);
    const catOf = new Map<string, HardwareCategory>(project.hardware.map((h) => [h.id as string, h.category]));

    return allOperations(project)
      .map((op) => {
        const connId = op.sourceHardwareConnectionId;
        if (!connId) return null;
        const part = findPart(project, op.partId);
        if (!part) return null;
        const hwId = byConn.get(connId);
        const cat = hwId ? catOf.get(hwId) : undefined;
        const w = operationWorld(part, op.face, op.x, op.y);
        const inward = new THREE.Vector3(w.inward.x, w.inward.y, w.inward.z).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(UP, inward);
        const len = Math.max(op.depth ?? 12, 6) * MM_TO_UNIT;
        const pos = new THREE.Vector3(w.position.x, w.position.y, w.position.z)
          .multiplyScalar(MM_TO_UNIT)
          .add(inward.clone().multiplyScalar(len / 2));
        return {
          id: op.id,
          connId,
          r: Math.max((op.diameter ?? 6) / 2, 2) * MM_TO_UNIT,
          len,
          pos: [pos.x, pos.y, pos.z] as [number, number, number],
          quat: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
          color: (cat && HW_COLOR[cat]) || '#c0a060',
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [project]);

  return (
    <group>
      {glyphs.map((g) => (
        <mesh key={g.id} position={g.pos} quaternion={g.quat}>
          <cylinderGeometry args={[g.r, g.r, g.len, 12]} />
          <meshStandardMaterial
            color={g.connId === selectedId ? '#ffcf4c' : g.color}
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Визуализация присадки: маркеры отверстий на деталях. */
function MachiningLayer({
  project,
  selectedId,
  onSelect,
  onlyPartId,
  highlightConnectionId,
}: {
  project: Project;
  selectedId: MachiningId | null;
  onSelect: (id: MachiningId) => void;
  /** Показывать присадку только выбранной детали (§38). */
  onlyPartId?: string | null;
  /** Подсветить операции выбранного соединения (§40). */
  highlightConnectionId?: string | null;
}) {
  const markers = useMemo(() => {
    return allOperations(project)
      .filter((op) => !onlyPartId || String(op.partId) === String(onlyPartId))
      .map((op) => {
        const part = findPart(project, op.partId);
        if (!part) return null;
        const w = operationWorld(part, op.face, op.x, op.y);
        return {
          id: op.id,
          origin: op.origin,
          connId: op.sourceHardwareConnectionId ? String(op.sourceHardwareConnectionId) : null,
          r: Math.max((op.diameter ?? 6) / 2, 3) * MM_TO_UNIT,
          pos: [w.position.x * MM_TO_UNIT, w.position.y * MM_TO_UNIT, w.position.z * MM_TO_UNIT] as [number, number, number],
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [project, onlyPartId]);

  return (
    <group>
      {markers.map((m) => {
        const sel = m.id === selectedId;
        const inConn = highlightConnectionId != null && m.connId === highlightConnectionId;
        const color = sel ? '#ffcf4c' : inConn ? '#7ad1a0' : m.origin === 'manual' ? '#e0803c' : '#e5534b';
        return (
          <mesh
            key={m.id}
            position={m.pos}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(m.id);
            }}
          >
            <sphereGeometry args={[sel || inConn ? m.r * 1.6 : m.r, 12, 12]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Визуализация связей фурнитуры: линия между центрами деталей + точка. */
function ConnectionsLayer({ project, selectedId }: { project: Project; selectedId: string | null }) {
  const lines = useMemo(() => {
    const out: Array<{ id: string; a: [number, number, number]; b: [number, number, number]; sel: boolean }> = [];
    for (const c of project.hardwareConnections) {
      const pa = findPart(project, c.partAId);
      const pb = findPart(project, c.partBId);
      if (!pa || !pb) continue;
      const ca = partWorldAABB(pa);
      const cb = partWorldAABB(pb);
      const mid = (x: { min: number; max: number }) => (x.min + x.max) / 2;
      out.push({
        id: c.id,
        a: [mid({ min: ca.min.x, max: ca.max.x }) * MM_TO_UNIT, mid({ min: ca.min.y, max: ca.max.y }) * MM_TO_UNIT, mid({ min: ca.min.z, max: ca.max.z }) * MM_TO_UNIT],
        b: [mid({ min: cb.min.x, max: cb.max.x }) * MM_TO_UNIT, mid({ min: cb.min.y, max: cb.max.y }) * MM_TO_UNIT, mid({ min: cb.min.z, max: cb.max.z }) * MM_TO_UNIT],
        sel: c.id === selectedId,
      });
    }
    return out;
  }, [project, selectedId]);

  return (
    <group>
      {lines.map((l) => {
        const mid: [number, number, number] = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2, (l.a[2] + l.b[2]) / 2];
        const color = l.sel ? '#ffcf4c' : '#4c8dff';
        return (
          <group key={l.id}>
            <Line points={[l.a, l.b]} color={color} lineWidth={l.sel ? 3 : 1.5} />
            <mesh position={mid}>
              <sphereGeometry args={[l.sel ? 0.02 : 0.014, 12, 12]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export interface CameraApi {
  setView: (view: StandardView) => void;
  focusOn: (point: [number, number, number]) => void;
  fitAll: (box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => void;
}

/** Мост между HTML-кнопками видов и камерой внутри Canvas. */
function CameraRig({ apiRef }: { apiRef: React.MutableRefObject<CameraApi | null> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  apiRef.current = {
    setView: (view) => {
      const [x, y, z] = VIEW_POSITIONS[view];
      camera.position.set(x, y, z);
      camera.up.set(0, 1, 0);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      camera.lookAt(0, 0, 0);
    },
    focusOn: ([x, y, z]) => {
      // Приблизить камеру к точке, сохранив направление обзора.
      const dir = { x: camera.position.x - (controls?.target.x ?? 0), y: camera.position.y - (controls?.target.y ?? 0), z: camera.position.z - (controls?.target.z ?? 0) };
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const dist = 1.2;
      camera.position.set(x + (dir.x / len) * dist, y + (dir.y / len) * dist, z + (dir.z / len) * dist);
      if (controls) {
        controls.target.set(x, y, z);
        controls.update();
      }
      camera.lookAt(x, y, z);
    },
    fitAll: (box) => {
      // Подобрать дистанцию так, чтобы вся модель попала в кадр.
      const cx = ((box.min.x + box.max.x) / 2) * MM_TO_UNIT;
      const cy = ((box.min.y + box.max.y) / 2) * MM_TO_UNIT;
      const cz = ((box.min.z + box.max.z) / 2) * MM_TO_UNIT;
      const sx = (box.max.x - box.min.x) * MM_TO_UNIT;
      const sy = (box.max.y - box.min.y) * MM_TO_UNIT;
      const sz = (box.max.z - box.min.z) * MM_TO_UNIT;
      const radius = Math.max(0.2, Math.hypot(sx, sy, sz) / 2);
      const persp = camera as THREE.PerspectiveCamera;
      const fov = (persp.fov ?? 45) * (Math.PI / 180);
      const dist = (radius / Math.sin(fov / 2)) * 1.15;
      const dir = new THREE.Vector3(1, 0.75, 1).normalize();
      camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
      if (controls) {
        controls.target.set(cx, cy, cz);
        controls.update();
      }
      camera.lookAt(cx, cy, cz);
    },
  };
  return null;
}

/** Гизмо перемещения выбранной детали: коммит позиции в модель на отпускании. */
function TransformGizmo({ part, snap, onCommit }: { part: Part; snap: number; onCommit: (pos: { x: number; y: number; z: number }) => void }) {
  const obj = useMemo(() => new THREE.Object3D(), []);
  const g = partBoxGeometry(part);
  useEffect(() => {
    obj.position.set(g.position.x * MM_TO_UNIT, g.position.y * MM_TO_UNIT, g.position.z * MM_TO_UNIT);
  }, [obj, g.position.x, g.position.y, g.position.z]);
  return (
    <TransformControls
      object={obj}
      mode="translate"
      translationSnap={Math.max(1, snap) * MM_TO_UNIT}
      onMouseUp={() => onCommit({ x: obj.position.x / MM_TO_UNIT, y: obj.position.y / MM_TO_UNIT, z: obj.position.z / MM_TO_UNIT })}
    />
  );
}

/** Габаритные размеры модели (значения из ProjectModel, не из mesh). */
function DimensionsOverlay({ parts }: { parts: Part[] }) {
  const d = useMemo(() => overallDimensions(parts), [parts]);
  if (d.width === 0) return null;
  const cx = ((d.min.x + d.max.x) / 2) * MM_TO_UNIT;
  const label = (text: string, pos: [number, number, number]) => (
    <Html position={pos} center style={{ pointerEvents: 'none' }}>
      <div style={{ background: 'rgba(20,20,24,0.85)', color: '#e6e7e9', padding: '1px 5px', borderRadius: 3, fontSize: 11, whiteSpace: 'nowrap' }}>{text}</div>
    </Html>
  );
  return (
    <group>
      {label(`Ш ${d.width}`, [cx, d.min.y * MM_TO_UNIT - 0.05, d.max.z * MM_TO_UNIT])}
      {label(`В ${d.height}`, [d.max.x * MM_TO_UNIT + 0.05, ((d.min.y + d.max.y) / 2) * MM_TO_UNIT, d.max.z * MM_TO_UNIT])}
      {label(`Г ${d.depth}`, [d.max.x * MM_TO_UNIT + 0.05, d.min.y * MM_TO_UNIT, ((d.min.z + d.max.z) / 2) * MM_TO_UNIT])}
    </group>
  );
}

/** Мост для экспорта PNG: сохраняет ссылку на WebGL-контекст. */
function CaptureBridge({ apiRef }: { apiRef: React.MutableRefObject<{ capture: () => string } | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  apiRef.current = {
    capture: () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    },
  };
  return null;
}

export function Scene3D({
  showNumbers,
  bodyMode = 'construction',
  captureRef,
  cameraRef,
}: {
  showNumbers?: boolean;
  bodyMode?: 'construction' | 'body';
  captureRef?: React.MutableRefObject<{ capture: () => string } | null>;
  cameraRef?: React.MutableRefObject<CameraApi | null>;
}) {
  const construction = bodyMode === 'construction';
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectedOperationId = useEditorStore((s) => s.selectedOperationId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectOperation = useEditorStore((s) => s.selectOperation);
  const updatePart = useEditorStore((s) => s.updatePart);
  const focusNonce = useEditorStore((s) => s.focusNonce);
  const viewer = useEditorStore((s) => s.viewer);
  const machiningMode = viewer.machiningMode;
  const showMachining = machiningMode !== 'off' || viewer.showMachining;
  const showHardware = viewer.showHardware;

  const localApiRef = useRef<CameraApi | null>(null);
  const apiRef = cameraRef ?? localApiRef;
  const localCaptureRef = useRef<{ capture: () => string } | null>(null);
  const capRef = captureRef ?? localCaptureRef;

  const allVisible = useMemo(() => allParts(project).filter((p) => p.metadata?.hidden !== true), [project]);
  const parts = useMemo(
    () => (viewer.isolatedPartId ? allVisible.filter((p) => p.id === viewer.isolatedPartId) : allVisible),
    [allVisible, viewer.isolatedPartId],
  );
  const collisions = useMemo(() => detectCollisions(allVisible), [allVisible]);
  const selectedPart = selectedPartId ? findPart(project, selectedPartId) : undefined;
  const movable = viewer.tool === 'move' && selectedPart && selectedPart.metadata?.locked !== true;
  const materials = project.materials;

  // Фокус камеры на выбранной детали по запросу (кнопка «Показать»).
  useEffect(() => {
    if (focusNonce === 0 || !selectedPartId) return;
    const part = parts.find((p) => p.id === selectedPartId);
    if (!part) return;
    const box = partWorldAABB(part);
    apiRef.current?.focusOn([
      ((box.min.x + box.max.x) / 2) * MM_TO_UNIT,
      ((box.min.y + box.max.y) / 2) * MM_TO_UNIT,
      ((box.min.z + box.max.z) / 2) * MM_TO_UNIT,
    ]);
  }, [focusNonce, selectedPartId, parts]);

  const materialMap = useMemo(() => {
    const map = new Map<MaterialId, Material>();
    for (const m of materials) map.set(m.id, m);
    return map;
  }, [materials]);

  const edgeColorOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of project.edges) map.set(e.id, e.color);
    return (id: string | null) => (id ? map.get(id) : undefined);
  }, [project.edges]);

  // Перемещение детали: запись позиции в ProjectModel (3D не хранит позицию).
  const commitMove = (pos: { x: number; y: number; z: number }) => {
    if (!selectedPart) return;
    const snap = Math.max(1, viewer.snap);
    const snapped = {
      x: Math.round(pos.x / snap) * snap,
      y: Math.round(pos.y / snap) * snap,
      z: Math.round(pos.z / snap) * snap,
    };
    const issues = validatePartChange(project, String(selectedPart.id), { position: snapped });
    if (issues.some((i) => i.severity === 'error')) return; // недопустимо — не сохраняем
    updatePart(selectedPart.id as PartId, { position: snapped });
  };

  return (
    <>
      <ViewControls onSetView={(v) => apiRef.current?.setView(v)} />
      {collisions.length > 0 && (
        <div className="collision-warning">
          Пересечение деталей: {collisions.slice(0, 3).map((c) => `${c.aName} ↔ ${c.bName}`).join('; ')}
          {collisions.length > 3 ? ` и ещё ${collisions.length - 3}` : ''}
        </div>
      )}
      <Canvas camera={{ position: VIEW_POSITIONS.perspective, fov: 45, near: 0.01, far: 100 }} gl={{ preserveDrawingBuffer: true }}>
        <CameraRig apiRef={apiRef} />
        <CaptureBridge apiRef={capRef} />
        <color attach="background" args={['#17181b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} />

        {viewer.showGrid && <gridHelper args={[10, 20, '#444a52', '#2c3036']} />}
        {viewer.showAxes && <axesHelper args={[1.5]} />}

        {/* Клик по пустому месту снимает выбор. */}
        <mesh position={[0, -0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={() => selectPart(null)} visible={false}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial />
        </mesh>

        {parts.map((part) => (
          <PartMesh
            key={part.id}
            part={part}
            material={part.material ? materialMap.get(part.material) : undefined}
            selected={part.id === selectedPartId}
            showNumber={showNumbers}
            displayMode={viewer.displayMode}
            edgeColorOf={edgeColorOf}
            onSelect={selectPart}
          />
        ))}

        {viewer.showDimensions && <DimensionsOverlay parts={parts} />}
        {movable && selectedPart && (
          <TransformGizmo part={selectedPart} snap={viewer.snap} onCommit={commitMove} />
        )}

        {construction && <ConnectionsLayer project={project} selectedId={selectedConnectionId} />}
        {construction && showHardware && (
          <HardwareLayer project={project} selectedId={selectedConnectionId} />
        )}
        {construction && showMachining && (
          <MachiningLayer
            project={project}
            selectedId={selectedOperationId}
            onSelect={selectOperation}
            onlyPartId={machiningMode === 'selected' ? selectedPartId : null}
            highlightConnectionId={selectedConnectionId}
          />
        )}

        <OrbitControls makeDefault enablePan enableZoom enableRotate />
      </Canvas>
    </>
  );
}
