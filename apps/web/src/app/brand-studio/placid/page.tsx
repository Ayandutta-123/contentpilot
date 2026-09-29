'use client';

import { AuthGuard } from '@/components/auth-guard';
import BrandStudioWorkspace from '@/components/brand-studio-workspace';

export default function BrandStudioPlacidPage() {
  return (
    <AuthGuard>
      <BrandStudioWorkspace forcedWorkspace="placid" fullPage />
    </AuthGuard>
  );
}
