'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RunsPage } from '@inngest/components/RunsPage/RunsPage';
import { type Run } from '@inngest/components/RunsPage/RunsTable';
import {
  useSearchParam,
  useStringArraySearchParam,
} from '@inngest/components/hooks/useSearchParam';
import { getTimestampDaysAgo } from '@inngest/components/utils/date';

import { useEnvironment } from '@/app/(organization-active)/(dashboard)/env/[environmentSlug]/environment-context';
import { useGetRun } from '@/components/RunDetails/useGetRun';
import { useGetTraceResult } from '@/components/RunDetails/useGetTraceResult';
import { useGetTrigger } from '@/components/RunDetails/useGetTrigger';
import { graphql } from '@/gql';
import { RunsOrderByField } from '@/gql/graphql';
import { useCancelRun } from '@/queries/useCancelRun';
import { useRerun } from '@/queries/useRerun';
import { pathCreator } from '@/utils/urls';
import { useSkippableGraphQLQuery } from '@/utils/useGraphQLQuery';
import { usePlanFeatures } from './usePlanFeatures';
import { parseRunsData, toRunStatuses, toTimeField } from './utils';

const GetRunsDocument = graphql(`
  query GetRuns(
    $environmentID: ID!
    $startTime: Time!
    $status: [FunctionRunStatus!]
    $timeField: RunsOrderByField!
    $functionSlug: String!
    $functionRunCursor: String = null
  ) {
    environment: workspace(id: $environmentID) {
      runs(
        filter: { from: $startTime, status: $status, timeField: $timeField, fnSlug: $functionSlug }
        orderBy: [{ field: $timeField, direction: DESC }]
        after: $functionRunCursor
      ) {
        edges {
          node {
            id
            queuedAt
            endedAt
            startedAt
            status
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
  }
`);

export default function Page({
  params,
}: {
  params: {
    slug: string;
  };
}) {
  const functionSlug = decodeURIComponent(params.slug);

  const [rawFilteredStatus] = useStringArraySearchParam('filterStatus');
  const [rawTimeField = RunsOrderByField.QueuedAt] = useSearchParam('timeField');
  const [lastDays = '3'] = useSearchParam('last');

  const timeField = toTimeField(rawTimeField) ?? RunsOrderByField.QueuedAt;

  /* TODO: Time params for absolute time filter */
  // const [fromTime, setFromTime] = useSearchParam('from');
  // const [untilTime, setUntilTime] = useSearchParam('until');

  /* TODO: When we have absolute time, the start date will be either coming from the date picker or the relative time */
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [cursor, setCursor] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [isScrollRequest, setIsScrollRequest] = useState(false);

  const env = useEnvironment();
  const cancelRun = useCancelRun({ envID: env.id });
  const rerun = useRerun({ envID: env.id, envSlug: env.slug });
  const getTraceResult = useGetTraceResult();
  const getTrigger = useGetTrigger();
  const getRun = useGetRun();
  const features = usePlanFeatures();

  const internalPathCreator = useMemo(() => {
    return {
      // The shared component library is environment-agnostic, so it needs a way to
      // generate URLs without knowing about environments
      app: (params: { externalAppID: string }) =>
        pathCreator.app({ envSlug: env.slug, externalAppID: params.externalAppID }),
      runPopout: (params: { runID: string }) =>
        pathCreator.runPopout({ envSlug: env.slug, runID: params.runID }),
    };
  }, [env.slug]);

  useEffect(() => {
    if (lastDays) {
      setStartTime(
        getTimestampDaysAgo({
          currentDate: new Date(),
          days: parseInt(lastDays),
        })
      );
    }
  }, [lastDays]);

  const filteredStatus = useMemo(() => {
    return toRunStatuses(rawFilteredStatus ?? []);
  }, [rawFilteredStatus]);

  const environment = useEnvironment();
  const firstPageRes = useSkippableGraphQLQuery({
    query: GetRunsDocument,
    skip: !functionSlug || isScrollRequest,
    variables: {
      environmentID: environment.id,
      functionSlug,
      startTime: startTime.toISOString(),
      status: filteredStatus.length > 0 ? filteredStatus : null,
      timeField,
      functionRunCursor: null,
    },
  });

  const nextPageRes = useSkippableGraphQLQuery({
    query: GetRunsDocument,
    skip: !functionSlug || !isScrollRequest,
    variables: {
      environmentID: environment.id,
      functionSlug,
      startTime: startTime.toISOString(),
      status: filteredStatus.length > 0 ? filteredStatus : null,
      timeField,
      functionRunCursor: cursor,
    },
  });

  if (firstPageRes.error || nextPageRes.error) {
    throw firstPageRes.error || nextPageRes.error;
  }

  const firstPageRunsData = firstPageRes.data?.environment.runs.edges;
  const nextPageRunsData = nextPageRes.data?.environment.runs.edges;
  const firstPageInfo = firstPageRes.data?.environment.runs.pageInfo;
  const nextPageInfo = nextPageRes.data?.environment.runs.pageInfo;
  const hasNextPage = nextPageInfo?.hasNextPage || firstPageInfo?.hasNextPage;
  const isLoading = firstPageRes.isLoading || nextPageRes.isLoading;

  if (functionSlug && !firstPageRunsData && !firstPageRes.isLoading && !firstPageRes.isSkipped) {
    throw new Error('missing run');
  }

  const firstPageRuns = useMemo(() => {
    return parseRunsData(firstPageRunsData);
  }, [firstPageRunsData]);

  const nextPageRuns = useMemo(() => {
    return parseRunsData(nextPageRunsData);
  }, [nextPageRunsData]);

  useEffect(() => {
    if (!isScrollRequest) {
      setRuns(firstPageRuns);
    }
  }, [firstPageRuns, isScrollRequest]);

  useEffect(() => {
    if (isScrollRequest && nextPageRuns.length > 0) {
      setRuns((prevRuns) => [...prevRuns, ...nextPageRuns]);
    }
  }, [nextPageRuns, isScrollRequest]);

  const fetchMoreOnScroll: React.ComponentProps<typeof RunsPage>['onScroll'] = useCallback(
    (event) => {
      if (runs.length > 0) {
        const { scrollHeight, scrollTop, clientHeight } = event.target as HTMLDivElement;
        const lastCursor = nextPageInfo?.endCursor || firstPageInfo?.endCursor;
        // Check if scrolled to the bottom
        const reachedBottom = scrollHeight - scrollTop - clientHeight < 200;
        if (reachedBottom && !isLoading && lastCursor && hasNextPage) {
          setIsScrollRequest(true);
          setCursor(lastCursor);
        }
      }
    },
    [firstPageRes.isLoading, nextPageRes.isLoading, runs, nextPageInfo, firstPageInfo]
  );

  const onScrollToTop = useCallback(() => {
    setIsScrollRequest(false);
  }, []);

  return (
    <RunsPage
      cancelRun={cancelRun}
      data={runs}
      features={{
        history: features.data?.history ?? 7,
      }}
      functionSlug={functionSlug}
      hasMore={hasNextPage ?? false}
      isLoadingInitial={firstPageRes.isLoading}
      isLoadingMore={nextPageRes.isLoading}
      getRun={getRun}
      onScroll={fetchMoreOnScroll}
      onScrollToTop={onScrollToTop}
      getTraceResult={getTraceResult}
      getTrigger={getTrigger}
      pathCreator={internalPathCreator}
      rerun={rerun}
    />
  );
}
