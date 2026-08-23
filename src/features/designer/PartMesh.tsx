import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Material, Part } from '@/core/model/types';
import { partBoxGeometry } from '@/core/geometry/partGeometry';

// Масштаб: 1 единица three = 1 метр; модель в мм → делим на 1000.
const MM_TO_UNIT = 1 / 1000;

interface Props {
  part: Part;
  material?: Material;
  selected: boolean;
  onSelect: (id: Part['id']) => void;
}

/**
 * 3D-представление детали. Геометрия выводится из производственной модели
 * (Part → partBoxGeometry → BoxGeometry). Изменение размеров детали
 * автоматически меняет визуальный размер (пересчёт useMemo по зависимостям).
 */
export function PartMesh({ part, material, selected, onSelect }: Props) {
  const geom = useMemo(() => partBoxGeometry(part), [part]);

  const color = material?.color ?? '#c9b18a';

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
      />
    </mesh>
  );
}
