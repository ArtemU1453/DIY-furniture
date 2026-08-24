import { useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts, findPart } from '@/core/model/selectors';
import { partWorldAABB } from '@/core/geometry/partGeometry';
import { operationWorld } from '@/core/geometry/coordinateSystem';
import { allOperations } from '@/engines/machining';
import type { MachiningId, MaterialId } from '@/core/model/ids';
import type { Material, Project } from '@/core/model/types';
import { PartMesh } from './PartMesh';
import { ViewControls, type StandardView, VIEW_POSITIONS } from './ViewControls';

const MM_TO_UNIT = 1 / 1000;

/** Визуализация присадки: маркеры отверстий на деталях. */
function MachiningLayer({
  project,
  selectedId,
  onSelect,
}: {
  project: Project;
  selectedId: MachiningId | null;
  onSelect: (id: MachiningId) => void;
}) {
  const markers = useMemo(() => {
    return allOperations(project)
      .map((op) => {
        const part = findPart(project, op.partId);
        if (!part) return null;
        const w = operationWorld(part, op.face, op.x, op.y);
        return {
          id: op.id,
          origin: op.origin,
          r: Math.max((op.diameter ?? 6) / 2, 3) * MM_TO_UNIT,
          pos: [w.position.x * MM_TO_UNIT, w.position.y * MM_TO_UNIT, w.position.z * MM_TO_UNIT] as [number, number, number],
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [project]);

  return (
    <group>
      {markers.map((m) => {
        const sel = m.id === selectedId;
        const color = sel ? '#ffcf4c' : m.origin === 'manual' ? '#e0803c' : '#e5534b';
        return (
          <mesh
            key={m.id}
            position={m.pos}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(m.id);
            }}
          >
            <sphereGeometry args={[sel ? m.r * 1.6 : m.r, 12, 12]} />
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

interface CameraApi {
  setView: (view: StandardView) => void;
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
  };
  return null;
}

export function Scene3D({ showNumbers, showMachining }: { showNumbers?: boolean; showMachining?: boolean }) {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectedConnectionId = useEditorStore((s) => s.selectedConnectionId);
  const selectedOperationId = useEditorStore((s) => s.selectedOperationId);
  const selectPart = useEditorStore((s) => s.selectPart);
  const selectOperation = useEditorStore((s) => s.selectOperation);

  const apiRef = useRef<CameraApi | null>(null);

  const parts = useMemo(() => allParts(project), [project]);
  const materials = project.materials;

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

  return (
    <>
      <ViewControls onSetView={(v) => apiRef.current?.setView(v)} />
      <Canvas camera={{ position: VIEW_POSITIONS.perspective, fov: 45, near: 0.01, far: 100 }}>
        <CameraRig apiRef={apiRef} />
        <color attach="background" args={['#17181b']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.1} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} />

        <gridHelper args={[10, 20, '#444a52', '#2c3036']} />
        <axesHelper args={[1.5]} />

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
            edgeColorOf={edgeColorOf}
            onSelect={selectPart}
          />
        ))}

        <ConnectionsLayer project={project} selectedId={selectedConnectionId} />
        {showMachining && (
          <MachiningLayer project={project} selectedId={selectedOperationId} onSelect={selectOperation} />
        )}

        <OrbitControls makeDefault enablePan enableZoom enableRotate />
      </Canvas>
    </>
  );
}
