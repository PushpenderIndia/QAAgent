'use client';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal markdown renderer — bold, inline code, and ordered/unordered lists.
// The agent's replies are short and use a narrow subset of markdown, so a full
// CommonMark parser would be overkill here.
function renderMarkdown(md) {
  if (!md) return '';
  let html = escapeHtml(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  const lines = html.split('\n');
  const out = [];
  let listType = null;
  const closeList = () => {
    if (listType) {
      out.push('</' + listType + '>');
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const ol = line.match(/^(\d+)\.\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push('<li>' + ol[2] + '</li>');
    } else if (ul) {
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push('<li>' + ul[1] + '</li>');
    } else {
      closeList();
      out.push('<p>' + line + '</p>');
    }
  }
  closeList();
  return out.join('');
}

export default function ResultPanel({ run, submitError, onWatchVideo, onOpenTrace }) {
  if (submitError) {
    return (
      <div className="card flex-card">
        <p className="panel-title">Result</p>
        <div id="result">
          <span className="placeholder">{submitError}</span>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="card flex-card">
        <p className="panel-title">Result</p>
        <div id="result">
          <span className="placeholder">Run a test to see the outcome, video replay, and trace here.</span>
        </div>
      </div>
    );
  }

  if (run.status === 'running') {
    return (
      <div className="card flex-card">
        <p className="panel-title">Result</p>
        <div id="result">
          <span className="placeholder">Running…</span>
        </div>
      </div>
    );
  }

  const markdownHtml = renderMarkdown(run.result || run.error || '(no output)');

  return (
    <div className="card flex-card">
      <p className="panel-title">Result</p>
      <div id="result">
        <div className="result-text" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
        <div className="result-actions">
          {run.videoUrl && (
            <button className="btn-secondary" onClick={() => onWatchVideo(run.videoUrl)}>
              <span className="material-symbols-outlined">movie</span> Watch replay
            </button>
          )}
          {run.tracePath && (
            <button className="btn-secondary" onClick={() => onOpenTrace(run.id)}>
              <span className="material-symbols-outlined">manage_search</span> Open trace viewer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
