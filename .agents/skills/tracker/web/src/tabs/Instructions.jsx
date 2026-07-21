import React, { useState } from 'react';
import { api } from '../lib/api.js';

export default function Instructions({ state, onChanged }) {
  const [text, setText] = useState(state.instructions || '');
  const [status, setStatus] = useState('');
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-5 max-w-[900px] w-full mx-auto">
      <textarea
        className="inp flex-1 resize-none !p-4 leading-relaxed"
        spellCheck={false}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={'# My Application Instructions\n\n## never-apply\n\n- Company A'}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-dim">~/.coforce/instructions.md — standing rules every skill obeys; keep the "## never-apply" section structure</span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-faint">{status}</span>
          <button
            className="btn"
            onClick={async () => {
              try {
                await api.saveInstructions(text);
                setStatus('Saved ✓');
                onChanged();
                setTimeout(() => setStatus(''), 2000);
              } catch (e) {
                setStatus(`Save failed: ${e.message}`);
              }
            }}
          >
            Save instructions
          </button>
        </div>
      </div>
    </div>
  );
}
