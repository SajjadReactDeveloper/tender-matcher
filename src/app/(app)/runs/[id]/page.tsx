import { RunDetail } from '@/components/runs/RunDetail';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  return <RunDetail id={(await params).id} />;
}
