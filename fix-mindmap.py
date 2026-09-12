with open('public/app.js', 'r') as f:
    content = f.read()

old = '''/**
 * Build mindmap elements from original elements.
 * Shows only semantic keywords (not folder/space names) for a clean hierarchical view.
 */
function buildMindmapElements() {
  if (!originalElements) return null;

  // Get folder names from exports/ to filter them out
  var folderNames = new Set();
  try {
    // Read the exports directory to get folder names for filtering
    var files = originalElements.nodes.filter(function(n) { return n.data.kind === "file"; });
    files.forEach(function(f) {
      var path = f.data.path || "";
      var folder = path.split(/[\\/]/)[0];
      if (folder) folderNames.add(folder);
    });
  } catch (e) {}

  // Filter to only semantic keywords: kind === 'keyword' AND label is not a folder name
  // The folder nodes have labels like "BabaDev", "Agile_Project_Manager" etc.
  // We filter out any keyword whose label matches a folder name.
  var semanticKeywords = originalElements.nodes.filter(function(n) {
    return n.data.kind === "keyword" && !folderNames.has(n.data.label);
  });

  // If no semantic keywords (only folder nodes exist), fall back to folder nodes
  // so the user still sees something meaningful.
  var keywordNodesToShow = semanticKeywords.length > 0 ? semanticKeywords :
    originalElements.nodes.filter(function(n) { return n.data.kind === "keyword"; });

  // Create virtual root node
  var rootId = "keyword:__root__";
  var rootLabel = semanticKeywords.length > 0 ? "Topics" : "All Conversations";
  var rootTitle = "986 files across 40 topics";'''

new = '''/**
 * Build mindmap elements from original elements.
 * Shows folder/space nodes (conversation groups) as organizational keywords.
 * Produces a clean hierarchical tree: root -> 40 folder nodes.
 */
function buildMindmapElements() {
  if (!originalElements) return null;

  // Always show folder nodes (conversation spaces) as organizational groups.
  // These represent the 40 conversation topics from the exports/ structure.
  var folderNodes = originalElements.nodes.filter(function(n) { return n.data.kind === "keyword"; });
  var folderEdges = originalElements.edges.filter(function(e) { return e.data.kind === "cofolder"; });

  // Create virtual root node
  var rootId = "keyword:__root__";
  var folderCount = folderNodes.length;
  var rootNode = {
    data: {
      id: rootId,
      kind: "keyword",
      label: "All Conversations",
      title: folderCount + " conversation spaces (986 files)",
      isRoot: true
    }
  };'''

content = content.replace(old, new)

# Also fix the rest of the function
old2 = '''  // Create edges from root to each selected keyword node
  var rootEdges = keywordNodesToShow.map(function(node) {
    return {
      data: {
        id: "tree:" + rootId + ">" + node.data.id,
        source: rootId,
        target: node.data.id,
        kind: "tree"
      }
    };
  });

  // Clone selected keyword nodes and add tree class for styling
  var mindmapFolderNodes = keywordNodesToShow.map(function(n) {
    return {
      data: {
        id: n.data.id,
        kind: "keyword",
        label: n.data.label,
        title: n.data.title,
        isRoot: false
      },
      classes: "cy-node-folder"
    };
  });'''

new2 = '''  // Create edges from root to each folder node
  var rootEdges = folderNodes.map(function(folderNode) {
    return {
      data: {
        id: "tree:" + rootId + ">" + folderNode.data.id,
        source: rootId,
        target: folderNode.data.id,
        kind: "tree"
      }
    };
  });

  // Clone folder nodes with clean styling class
  var mindmapFolderNodes = folderNodes.map(function(n) {
    return {
      data: {
        id: n.data.id,
        kind: "keyword",
        label: n.data.label,
        title: n.data.title,
        isRoot: false
      },
      classes: "cy-node-folder"
    };
  });'''

content = content.replace(old2, new2)

with open('public/app.js', 'w') as f:
    f.write(content)

print('Fixed!')
