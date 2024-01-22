import { useState } from 'react';
import ArrowPathIcon from '@heroicons/react/20/solid/ArrowPathIcon';
import { Button } from '@inngest/components/Button';
import { Modal } from '@inngest/components/Modal';
import { toast } from 'sonner';

import { DeployFailure } from '../../deploys/DeployFailure';
import { deployViaUrl, type RegistrationFailure } from '../../deploys/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  url: string;
};

export default function ResyncModal({ isOpen, onClose, url }: Props) {
  const [failure, setFailure] = useState<RegistrationFailure>();
  const [isSyncing, setIsSyncing] = useState(false);

  async function onSync() {
    setIsSyncing(true);

    let failure;
    try {
      // TODO: This component is using legacy syncs stuff that needs
      // reorginization and/or refactoring. We should use a GraphQL mutation
      // that gets the last sync URL, rather than relying on the UI to find it.
      failure = await deployViaUrl(url);

      setFailure(failure);
      if (!failure) {
        toast.success('Synced app');
        onClose();
      }
    } catch {
      setFailure({
        errorCode: undefined,
        headers: {},
        statusCode: undefined,
      });
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Modal
      className="w-[800px]"
      description="Send a new sync request to your app"
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="mb-4 flex flex-row items-center gap-3">
          <ArrowPathIcon className="h-6 w-6" />
          <h2 className="text-lg font-medium">Resync App</h2>
        </div>
      }
    >
      <div className="border-b border-slate-200 px-6">
        <p className="my-6">
          This will send a sync request to your app, telling it to sync itself with Inngest.
        </p>

        <p className="my-6">{"We'll"} send a request to the following URL:</p>

        <div className="my-6 overflow-scroll rounded bg-slate-200 p-2">
          <pre>
            <code className="">{url}</code>
          </pre>
        </div>

        {failure && !isSyncing && <DeployFailure {...failure} />}
      </div>

      <div className="flex flex-row justify-end gap-4 p-6">
        <Button
          appearance="outlined"
          btnAction={onClose}
          className="px-16"
          disabled={isSyncing}
          label="Cancel"
        />

        <Button
          btnAction={onSync}
          className="px-16"
          disabled={isSyncing}
          kind="primary"
          label="Resync App"
        />
      </div>
    </Modal>
  );
}