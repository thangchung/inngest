import { RiErrorWarningLine } from '@remixicon/react';

export default function EventLogsNotFound() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5">
      <div className="inline-flex items-center gap-2 text-yellow-600">
        <RiErrorWarningLine className="h-4 w-4" />
        <h2 className="text-sm">Could not find any logs for event</h2>
      </div>
    </div>
  );
}
