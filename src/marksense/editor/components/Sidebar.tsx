import { useState, useEffect, useCallback, useRef } from "react"
import { RefreshCw, Search, FileText, Folder, FolderOpen, Image, FileSpreadsheet, Presentation, File } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: FileNode[]
}

interface SidebarProps {
  activePath: string | null
  onFileSelect: (path: string) => void
  apiPrefix?: string
  /** Bump this to trigger a tree refresh from the parent. */
  refreshKey?: number
}

// ── File icon helper ──────────────────────────────────────────────────

function getFileIcon(name: string) {
  const ext = name.substring(name.lastIndexOf(".")).toLowerCase()
  switch (ext) {
    case ".png": case ".jpg": case ".jpeg": case ".gif": case ".svg": case ".webp":
      return <Image size={16} />
    case ".pdf":
      return <File size={16} />
    case ".xlsx":
      return <FileSpreadsheet size={16} />
    case ".pptx":
      return <Presentation size={16} />
    case ".docx":
      return <FileText size={16} />
    default:
      return <FileText size={16} />
  }
}

// ── Filter helper ──────────────────────────────────────────────────────

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes
  const lq = query.toLowerCase()
  return nodes
    .map((node) => {
      if (node.type === "file") {
        return node.name.toLowerCase().includes(lq) ? node : null
      }
      // Directory: include if any child matches
      const filteredChildren = filterTree(node.children || [], query)
      if (filteredChildren.length > 0) {
        return { ...node, children: filteredChildren }
      }
      // Also include if folder name itself matches
      if (node.name.toLowerCase().includes(lq)) return node
      return null
    })
    .filter(Boolean) as FileNode[]
}

// ── Sidebar ────────────────────────────────────────────────────────────

export function Sidebar({ activePath, onFileSelect, apiPrefix = "", refreshKey = 0 }: SidebarProps) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedPaths, setExpandedPaths] = useState<Map<string, boolean>>(new Map())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  const toggleExpanded = useCallback((nodePath: string, depth: number) => {
    setExpandedPaths((prev) => {
      const next = new Map(prev)
      const current = prev.has(nodePath) ? prev.get(nodePath)! : depth === 0
      next.set(nodePath, !current)
      return next
    })
  }, [])

  const isExpanded = useCallback(
    (nodePath: string, depth: number) => {
      return expandedPaths.has(nodePath) ? expandedPaths.get(nodePath)! : depth === 0
    },
    [expandedPaths]
  )

  const fetchTree = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${apiPrefix}/api/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTree(data)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [apiPrefix])

  const fetchRecent = useCallback(async () => {
    try {
      const res = await fetch(`${apiPrefix}/api/recent?limit=5`)
      if (res.ok) {
        const data = await res.json()
        setRecentFiles(data)
      }
    } catch { /* ignore */ }
  }, [apiPrefix])

  useEffect(() => {
    fetchTree()
    fetchRecent()
  }, [fetchTree, fetchRecent])

  // Re-fetch when parent signals a refresh
  useEffect(() => {
    if (refreshKey > 0) { fetchTree(); fetchRecent() }
  }, [refreshKey])

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [searchOpen])

  const handleSearchToggle = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setSearchQuery("")
      }
      return !prev
    })
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchOpen(false)
      setSearchQuery("")
    }
  }, [])

  const displayTree = searchQuery ? filterTree(tree, searchQuery) : tree

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-actions">
          <button
            className="sidebar-refresh"
            onClick={fetchTree}
            title="Refresh file tree"
            aria-label="Refresh file tree"
          >
            <RefreshCw size={15} />
          </button>
          <button
            className={`sidebar-refresh${searchOpen ? " active" : ""}`}
            onClick={handleSearchToggle}
            title="Search files"
            aria-label="Search files"
          >
            <Search size={15} />
          </button>
        </div>
        <input
          ref={searchInputRef}
          className={`sidebar-search-input${searchOpen ? " expanded" : ""}`}
          type="text"
          placeholder="Filter files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          tabIndex={searchOpen ? 0 : -1}
        />
      </div>
      <div className="sidebar-tree">
        {loading && <div className="sidebar-status">Loading...</div>}
        {error && <div className="sidebar-status sidebar-error">{error}</div>}
        {!loading && !error && recentFiles.length > 0 && (
          <div className="sidebar-recent">
            <div className="sidebar-section-label">RECENT</div>
            {recentFiles.map((filePath) => (
              <button
                key={filePath}
                className={`tree-item tree-file sidebar-recent-item${filePath === activePath ? " active" : ""}`}
                style={{ paddingLeft: "12px" }}
                onClick={() => onFileSelect(filePath)}
                title={filePath}
              >
                <span className="tree-name">
                  {filePath.split("/").pop()!.replace(/\.md$/i, "").split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
                </span>
              </button>
            ))}
          </div>
        )}
        {!loading &&
          !error &&
          displayTree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              activePath={activePath}
              onFileSelect={onFileSelect}
              isExpanded={isExpanded}
              toggleExpanded={toggleExpanded}
            />
          ))}
        {!loading && !error && searchQuery && displayTree.length === 0 && (
          <div className="sidebar-status">No matches</div>
        )}
      </div>
    </nav>
  )
}

// ── TreeNode ───────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  activePath,
  onFileSelect,
  isExpanded,
  toggleExpanded,
}: {
  node: FileNode
  depth: number
  activePath: string | null
  onFileSelect: (path: string) => void
  isExpanded: (path: string, depth: number) => boolean
  toggleExpanded: (path: string, depth: number) => void
}) {
  const isActive = node.type === "file" && node.path === activePath

  if (node.type === "directory") {
    const expanded = isExpanded(node.path, depth)
    return (
      <div className="tree-dir">
        <button
          className={`tree-item tree-dir-toggle${expanded ? " expanded" : ""}`}
          style={{ paddingLeft: `${8 + depth * 20}px` }}
          onClick={() => toggleExpanded(node.path, depth)}
        >
          <span className="tree-chevron">{expanded ? "\u25BE" : "\u25B8"}</span>
          <span className="tree-icon">
            {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
          <span className="tree-name">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onFileSelect={onFileSelect}
                isExpanded={isExpanded}
                toggleExpanded={toggleExpanded}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      className={`tree-item tree-file${isActive ? " active" : ""}`}
      style={{ paddingLeft: `${8 + depth * 20}px` }}
      onClick={() => onFileSelect(node.path)}
      title={node.path}
    >
      <span className="tree-icon">{getFileIcon(node.name)}</span>
      <span className="tree-name">{node.name}</span>
    </button>
  )
}
