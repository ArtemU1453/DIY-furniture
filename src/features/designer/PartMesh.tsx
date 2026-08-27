import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Material, Part } from '@/core/model/types';
import type { EdgeMaterialId } from '@/core/model/ids';
import { partBoxGeometry } from '@/core/geometry/partGeometry';

// Масштаб: 1 единица three = 1 метр; модель в мм → делим на 1000.
const MM_TO_UNIT = 1 / 1000;
const EDGE_VIS = 6 * MM_TO_UNIT; // визуальная толщина кромки

type DisplayMode = 'solid' | 'wireframe' | 'edges' | 'transparent';

interface Props {
  part: Part;
  material?: Material;
  selected: boolean;
  showNumber?: boolean;
  displayMode?: DisplayMode;
  edgeColorOf?: (id: EdgeMaterialId | null) => string | undefined;
  onSelect: (id: Part['id']) => void;
}

/**
 * 3D-представление детали. Геометрия выводится из производственной модели
 * (Part → partBoxGeometry → BoxGeometry). Изменение размеров детали
 * автоматически меняет визуальный размер (пересчёт useMemo по зависимостям).
 */
export function PartMesh({ part, material, selected, showNumber, displayMode = 'solid', edgeColorOf, onSelect }: Props) {
  const geom = useMemo(() => partBoxGeometry(part), [part]);
  const wireframe = displayMode === 'wireframe';
  const transparent = displayMode === 'transparent';
  const showEdges = displayMode === 'edges';

  const color = material?.color ?? '#c9b18a';
  const number = part.metadata?.number as string | undefined;

  const w = Math.max(geom.size.x, 1) * MM_TO_UNIT;
  const h = Math.max(geom.size.y, 1) * MM_TO_UNIT;
  const t = Math.max(geom.size.z, 1) * MM_TO_UNIT;

  // Полоски кромки на облицованных сторонах (в локальных координатах детали,
  // поэтому наследуют поворот детали и ложатся на нужные торцы).
  const edgeStrips = edgeColorOf
    ? ([
        { side: 'left', id: part.edges.left, pos: [-w / 2, 0, 0], size: [EDGE_VIS, h, t] },
        { side: 'right', id: part.edges.right, pos: [w / 2, 0, 0], size: [EDGE_VIS, h, t] },
        { side: 'top', id: part.edges.top, pos: [0, h / 2, 0], size: [w, EDGE_VIS, t] },
        { side: 'bottom', id: part.edges.bottom, pos: [0, -h / 2, 0], size: [w, EDGE_VIS, t] },
      ] as const)
        .map((s) => ({ ...s, color: edgeColorOf(s.id) }))
        .filter((s) => s.id && s.color)
    : [];

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(part.id);
  };

  return (
    <mesh
      position={[
        geom.position.x * MM_TO_UNIT,
        geom.position.y * MM_TO_UNIT,
        geom.position.z * MM_TO_UNIT,
      ]}
      rotation={[geom.rotation.x, geom.rotation.y, geom.rotation.z]}
      onClick={handleClick}
    >
      <boxGeometry
        args={[
          Math.max(geom.size.x, 1) * MM_TO_UNIT,
          Math.max(geom.size.y, 1) * MM_TO_UNIT,
          Math.max(geom.size.z, 1) * MM_TO_UNIT,
        ]}
      />
      <meshStandardMaterial
        color={color}
        emissive={selected ? '#4c8dff' : '#000000'}
        emissiveIntensity={selected ? 0.5 : 0}
        roughness={0.75}
        metalness={0.05}
        wireframe={wireframe}
        transparent={transparent}
        opacity={transparent ? 0.35 : 1}
      />
      {showEdges && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(w, h, t)]} />
          <lineBasicMaterial color={selected ? '#4c8dff' : '#1a1b1e'} />
        </lineSegments>
      )}
      {edgeStrips.map((s) => (
        <mesh key={s.side} position={s.pos as [number, number, number]}>
          <boxGeometry args={s.size as [number, number, number]} />
          <meshStandardMaterial color={s.color} roughness={0.6} />
        </mesh>
      ))}

      {showNumber && number && (
        <Html center distanceFactor={4} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: 'rgba(20,20,24,0.8)',
              color: '#fff',
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: 11,
              whiteSpace: 'nowrap',
            }}
          >
            {number}
          </div>
        </Html>
      )}
    </mesh>
  );
}
