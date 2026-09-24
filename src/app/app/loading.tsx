import { ListSkeleton } from '@/components/ui/layout';

// Esqueleto enquanto a tela carrega: a navegação (barra inferior / topo) continua usável.
export default function Loading() {
  return <ListSkeleton />;
}
