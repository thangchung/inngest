'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@inngest/components/Button';
import { RiAddLine } from '@remixicon/react';

import { useEnvironment } from '@/app/(organization-active)/(dashboard)/env/[environmentSlug]/environment-context';
import { pathCreator } from '@/utils/urls';
import { AppCard, EmptyAppCard, SkeletonCard } from './AppCard';
import { UnattachedSyncsCard } from './UnattachedSyncsCard';
import { useApps } from './useApps';

type Props = {
  isArchived?: boolean;
};

export function Apps({ isArchived = false }: Props) {
  const env = useEnvironment();
  const router = useRouter();

  const res = useApps({ envID: env.id, isArchived });
  if (res.error) {
    throw res.error;
  }
  if (res.isLoading && !res.data) {
    return (
      <div className="mb-4 mt-16 flex items-center justify-center">
        <div className="w-full max-w-[1200px]">
          <SkeletonCard />
        </div>
      </div>
    );
  }

  const { apps, latestUnattachedSyncTime } = res.data;
  const hasApps = apps.length > 0;
  // Sort apps by latest sync time
  const sortedApps = apps.sort((a, b) => {
    return (
      (b.latestSync ? new Date(b.latestSync.lastSyncedAt).getTime() : 0) -
      (a.latestSync ? new Date(a.latestSync.lastSyncedAt).getTime() : 0)
    );
  });

  return (
    <div className="mb-4 mt-16 flex items-center justify-center">
      <div className="w-full max-w-[1200px]">
        {!hasApps && !isArchived && (
          <EmptyAppCard className="mb-4">
            <div className="items-center md:items-start">
              <Button
                className="mt-4"
                kind="primary"
                label="Sync App"
                btnAction={() => router.push(pathCreator.createApp({ envSlug: env.slug }))}
                icon={<RiAddLine />}
              />
            </div>
          </EmptyAppCard>
        )}
        {!hasApps && isArchived && (
          <p className="rounded-lg bg-slate-500 p-4 text-center text-white">No archived apps</p>
        )}
        {sortedApps.map((app) => {
          return (
            <AppCard
              app={app}
              className="mb-4"
              envSlug={env.slug}
              key={app.id}
              isArchived={isArchived}
            />
          );
        })}

        {latestUnattachedSyncTime && !isArchived && (
          <UnattachedSyncsCard envSlug={env.slug} latestSyncTime={latestUnattachedSyncTime} />
        )}
      </div>
    </div>
  );
}
