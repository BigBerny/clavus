import type { PendingFile } from '../../state/chat'

type InputBarAttachmentsProps = {
  images: string[]
  files: PendingFile[]
  onRemoveImage: (index: number) => void
  onRemoveFile: (index: number) => void
}

export function InputBarAttachments({
  images,
  files,
  onRemoveImage,
  onRemoveFile,
}: InputBarAttachmentsProps) {
  if (images.length === 0 && files.length === 0) return null

  return (
    <div className="image-preview-strip mb-2 animate-[fadeSlideIn_0.2s_ease-out]">
      {images.map((img, i) => (
        <div key={`img-${i}`} className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-surface-light-3 dark:border-surface-dark-3">
          <img src={img} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
          <button
            onClick={() => onRemoveImage(i)}
            className="inline-btn absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-dark/80 dark:bg-surface-dark-3/90 text-white flex items-center justify-center text-xs backdrop-blur-sm"
            aria-label={`Remove image ${i + 1}`}
          >
            &times;
          </button>
        </div>
      ))}
      {files.map((file, i) => (
        <div key={`file-${i}`} className="relative flex-shrink-0 h-16 rounded-xl overflow-hidden border border-surface-light-3 dark:border-surface-dark-3 bg-surface-light-2 dark:bg-surface-dark-2 flex items-center gap-2 px-3 max-w-48">
          <svg className="w-4 h-4 flex-shrink-0 text-text-light-muted dark:text-text-dark-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate text-text-light dark:text-text-dark">{file.name}</div>
            <div className="text-[10px] text-text-light-muted dark:text-text-dark-muted">{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</div>
          </div>
          <button
            onClick={() => onRemoveFile(i)}
            className="inline-btn absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-dark/80 dark:bg-surface-dark-3/90 text-white flex items-center justify-center text-xs backdrop-blur-sm"
            aria-label={`Remove file ${file.name}`}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
