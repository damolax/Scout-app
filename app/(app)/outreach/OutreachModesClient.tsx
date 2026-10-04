'use client';

import { useState } from 'react';
import ManualOutreachClient from './ManualOutreachClient';
import MessageClient from '../message/MessageClient';
import type { Workspace } from '@/lib/types';

export default function OutreachModesClient({ workspace, replySyncEnabled, initialProspectId = '' }: { workspace: Workspace; replySyncEnabled: boolean; initialProspectId?: string }) {
  const [mode,setMode] = useState<'manual'|'automatic'>('manual');
  return <>
    <div className="card" style={{padding:10}}>
      <div className="actions">
        <button type="button" className={mode === 'manual' ? 'btn' : 'btn secondary'} onClick={()=>setMode('manual')}>Manual Review & Send</button>
        <button type="button" className={mode === 'automatic' ? 'btn' : 'btn secondary'} onClick={()=>setMode('automatic')}>Automatic Campaign</button>
      </div>
      <p className="muted" style={{margin:'10px 4px 0'}}>
        {mode === 'manual'
          ? 'Choose a prospect, review the populated message, then send one at a time.'
          : 'Choose a list, sender accounts and schedule. Scout continues sending server-side after you leave.'}
      </p>
    </div>
    {mode === 'manual'
      ? <ManualOutreachClient workspace={workspace} initialProspectId={initialProspectId} />
      : <MessageClient workspace={workspace} replySyncEnabled={replySyncEnabled} />}
  </>;
}
