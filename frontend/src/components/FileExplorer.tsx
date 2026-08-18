import { useState, useEffect } from 'react'
import { fetchFiles, readFile, writeFile, deleteFile } from '../api'
import type { FileItem } from '../types'
import { useI18n } from '../i18n'

interface FileExplorerProps {
  currentFile: string | null
  onFileSelect: (path: string, content: string) => void
  onFileDeleted: () => void
  onNewFile: () => void
}

export default function FileExplorer({ currentFile, onFileSelect, onFileDeleted, onNewFile }: FileExplorerProps) {
  const { t } = useI18n()
  const [files, setFiles] = useState<FileItem[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['']))
  const [loading, setLoading] = useState(false)

  const loadFiles = async (dir: string = '') => {
    setLoading(true)
    try {
      const items = await fetchFiles(dir)
      setFiles(items)
    } catch (e) {
      console.error('Failed to load files:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFiles('')
  }, [])

  const handleFileClick = async (file: FileItem) => {
    if (file.is_dir) {
      const newExpanded = new Set(expandedDirs)
      if (newExpanded.has(file.path)) {
        newExpanded.delete(file.path)
      } else {
        newExpanded.add(file.path)
      }
      setExpandedDirs(newExpanded)
      loadFiles(file.path)
    } else {
      try {
        const result = await readFile(file.path)
        onFileSelect(file.path, result.content)
      } catch (e) {
        console.error('Failed to read file:', e)
      }
    }
  }

  const handleDelete = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    if (!confirm(t('file.confirmDelete', { path }))) return
    try {
      await deleteFile(path)
      if (currentFile === path) onFileDeleted()
      loadFiles('')
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  const handleSave = async (path: string, content: string) => {
    try {
      await writeFile(path, content)
      loadFiles('')
    } catch (e) {
      console.error('Failed to save:', e)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#0d0d14] border-r border-[#2a2a3e]">
      <div className="flex items-center justify-between px-3 py-3 border-b border-[#2a2a3e]">
        <span className="text-xs font-semibold text-[#8888a0] uppercase tracking-wider">{t('file.title')}</span>
        <button
          onClick={onNewFile}
          className="w-6 h-6 flex items-center justify-center rounded-md bg-[#6366f1] hover:bg-[#818cf8] text-white text-sm transition-colors"
          title={t('file.new')}
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="px-3 py-2 text-xs text-[#8888a0]">{t('file.loading')}</div>
        ) : (
          files.map((file) => (
            <div
              key={file.path}
              onClick={() => handleFileClick(file)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm rounded-lg transition-colors hover:bg-[#1a1a2e] group ${
                currentFile === file.path ? 'bg-[#1a1a2e] text-[#818cf8]' : 'text-[#c0c0d0]'
              }`}
            >
              <span className="text-xs">
                {file.is_dir ? '📁' : file.path.endsWith('.py') ? '🐍' : file.path.endsWith('.js') || file.path.endsWith('.ts') ? '📜' : file.path.endsWith('.md') ? '📝' : '📄'}
              </span>
              <span className="flex-1 truncate">{file.name}</span>
              {!file.is_dir && (
                <button
                  onClick={(e) => handleDelete(e, file.path)}
                  className="opacity-0 group-hover:opacity-100 text-[#8888a0] hover:text-[#ef4444] text-xs"
                  title={t('file.delete')}
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
        {files.length === 0 && !loading && (
          <div className="px-3 py-6 text-xs text-[#8888a0] text-center leading-relaxed">
            {t('file.empty')}
            <br />
            {t('file.emptyHint')}
          </div>
        )}
      </div>
    </div>
  )
}