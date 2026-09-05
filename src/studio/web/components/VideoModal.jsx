'use client';

export default function VideoModal({ videoUrl, onClose }) {
  return (
    <div className={'modal-backdrop' + (videoUrl ? ' open' : '')}>
      <div className="modal">
        <video id="videoPlayer" controls autoPlay src={videoUrl || ''} />
        <button className="btn-secondary modal-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
