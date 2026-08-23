import { useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '@/app/store/editorStore';
import { allParts } from '@/core/model/selectors';
import type { MaterialId } from '@/core/model/ids';
import type { Material } from '@/core/model/types';
import { PartMesh } from './PartMesh';
import { ViewControls, type StandardView, VIEW_POSITIONS } from './ViewControls';

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

export function Scene3D() {
  const project = useEditorStore((s) => s.project);
  const selectedPartId = useEditorStore((s) => s.selectedPartId);
  const selectPart = useEditorStore((s) => s.selectPart);

  const apiRef = useRef<CameraApi | null>(null);

  const parts = useMemo(() => allParts(project), [project]);
  const materials = project.materials;

  const materialMap = useMemo(() => {
    const map = new Map<MaterialId, Material>();
    for (const m of materials) map.set(m.id, m);
    return map;
  }, [materials]);

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
            onSelect={selectPart}
          />
        ))}

        <OrbitControls makeDefault enablePan enableZoom enableRotate />
      </Canvas>
    </>
  );
}
