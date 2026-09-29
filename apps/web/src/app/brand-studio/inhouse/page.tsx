'use client';

import { AuthGuard } from '@/components/auth-guard';
import BrandStudioWorkspace from '@/components/brand-studio-workspace';

export default function BrandStudioInhousePage() {
  return (
    <AuthGuard>
      <BrandStudioWorkspace forcedWorkspace="inhouse" fullPage />
    </AuthGuard>
  );
}
