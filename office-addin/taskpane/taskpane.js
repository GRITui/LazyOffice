var currentRequest = '';
var outputType = 'document';
var attachments = []; // { id, type: 'file'|'link', name, mimeType, size, base64, url, role, roleReason }
var MAX_FILE_BYTES = 4 * 1024 * 1024;
var lastResult = null;

var ROLE_OPTIONS = [
  { value: 'raw_data', label: 'Raw data' },
  { value: 'template', label: 'Output template' },
  { value: 'reference_report', label: 'Reference report/presentation' },
  { value: 'other', label: 'Other' }
];

var HOST_META = {
  document: { badge: 'Word document', subtitle: 'Describe what you need, review the plan, then approve to insert it into this document.' },
  spreadsheet: { badge: 'Excel workbook', subtitle: 'Describe the data you need, review the plan, then approve to write it into this worksheet.' },
  presentation: { badge: 'PowerPoint presentation', subtitle: 'Describe the deck you need, review the plan, then approve to insert the slides into this presentation.' }
};

Office.onReady(function (info) {
  if (info.host === Office.HostType.Excel) {
    outputType = 'spreadsheet';
  } else if (info.host === Office.HostType.PowerPoint) {
    outputType = 'presentation';
  } else {
    outputType = 'document';
  }
  var meta = HOST_META[outputType];
  document.getElementById('host-badge').textContent = 'Inserting into your open ' + meta.badge;
  document.getElementById('subtitle').textContent = meta.subtitle;
  refreshProviderStatus();
});

// --- server calls -----------------------------------------------------

function apiCall(path, body) {
  return fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
      return data;
    });
  });
}

// --- attachments --------------------------------------------------------

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderAttachments() {
  var list = document.getElementById('attachment-list');
  list.innerHTML = '';
  attachments.forEach(function (a) {
    var li = document.createElement('li');
    var label = document.createElement('span');
    label.textContent = a.type === 'file' ? (a.name + ' (' + formatSize(a.size) + ')') : a.url;
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.setAttribute('aria-label', 'Remove ' + (a.type === 'file' ? a.name : a.url));
    removeBtn.textContent = '×';
    removeBtn.onclick = function () { removeAttachment(a.id); };
    li.appendChild(label);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function removeAttachment(id) {
  attachments = attachments.filter(function (a) { return a.id !== id; });
  renderAttachments();
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function handleFiles(fileList) {
  Array.prototype.forEach.call(fileList, function (file) {
    if (file.size > MAX_FILE_BYTES) {
      setStatus('"' + file.name + '" is over the 4MB limit and was skipped.', true, false);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(',')[1] || '';
      attachments.push({
        id: makeId(), type: 'file', name: file.name,
        mimeType: file.type || 'application/octet-stream', size: file.size, base64: base64
      });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  });
}

function addLink() {
  var input = document.getElementById('link-input');
  var url = input.value.trim();
  if (!url) return;
  try {
    new URL(url);
  } catch (err) {
    setStatus('That doesn\'t look like a valid URL.', true, false);
    return;
  }
  attachments.push({ id: makeId(), type: 'link', url: url });
  input.value = '';
  renderAttachments();
}

document.addEventListener('DOMContentLoaded', function () {
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function (e) {
    handleFiles(e.target.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files); });
  document.getElementById('link-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addLink(); }
  });
});

// --- flow -----------------------------------------------------------

function setStatus(msg, isError, loading) {
  document.getElementById('status-text').textContent = msg || '';
  document.getElementById('status').classList.toggle('error', !!isError);
  document.getElementById('spinner').classList.toggle('visible', !!loading);
}

function resetFlow() {
  currentRequest = '';
  attachments = [];
  lastResult = null;
  renderAttachments();
  document.getElementById('request').value = '';
  document.getElementById('link-input').value = '';
  document.getElementById('roles-box').style.display = 'none';
  document.getElementById('plan-box').style.display = 'none';
  document.getElementById('result-box').style.display = 'none';
  setStatus('');
}

function requestPlan() {
  currentRequest = document.getElementById('request').value.trim();
  if (!currentRequest) {
    setStatus('Enter a request first.', true, false);
    return;
  }
  document.getElementById('roles-box').style.display = 'none';
  document.getElementById('plan-box').style.display = 'none';
  document.getElementById('result-box').style.display = 'none';

  if (attachments.length > 0) {
    reviewFiles();
  } else {
    draftPlan();
  }
}

function reviewFiles() {
  setStatus('Reviewing your attached files...', false, true);
  document.getElementById('plan-btn').disabled = true;

  apiCall('/api/classifyAttachments', { attachments: attachments }).then(function (data) {
    applyRoles(data.roles);
    renderRolesList();
    document.getElementById('roles-box').style.display = 'block';
    setStatus('', false, false);
    document.getElementById('plan-btn').disabled = false;
  }).catch(function (err) {
    setStatus('Error reviewing files: ' + err.message, true, false);
    document.getElementById('plan-btn').disabled = false;
  });
}

function applyRoles(roles) {
  var byId = {};
  (roles || []).forEach(function (r) { byId[r.id] = r; });
  attachments.forEach(function (a) {
    var match = byId[a.id];
    a.role = (match && match.role) || 'other';
    a.roleReason = (match && match.reason) || 'Could not classify automatically — please check.';
  });
}

function renderRolesList() {
  var list = document.getElementById('roles-list');
  list.innerHTML = '';
  attachments.forEach(function (a) {
    var li = document.createElement('li');
    var top = document.createElement('div');
    top.className = 'roles-item-top';
    var label = document.createElement('span');
    label.className = 'roles-item-name';
    label.textContent = a.type === 'file' ? a.name : a.url;
    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Role for ' + (a.type === 'file' ? a.name : a.url));
    ROLE_OPTIONS.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (a.role === opt.value) o.selected = true;
      select.appendChild(o);
    });
    select.onchange = function () { a.role = select.value; };
    top.appendChild(label);
    top.appendChild(select);
    var reason = document.createElement('p');
    reason.className = 'roles-item-reason';
    reason.textContent = a.roleReason || '';
    li.appendChild(top);
    li.appendChild(reason);
    list.appendChild(li);
  });
}

function cancelRoleReview() {
  document.getElementById('roles-box').style.display = 'none';
  setStatus('');
}

function confirmRolesAndDraftPlan() {
  document.getElementById('roles-box').style.display = 'none';
  draftPlan();
}

function draftPlan() {
  setStatus('Thinking through a plan...', false, true);
  document.getElementById('plan-btn').disabled = true;

  apiCall('/api/getPlan', { request: currentRequest, attachments: attachments, outputType: outputType }).then(function (data) {
    document.getElementById('plan-text').textContent = data.plan;
    document.getElementById('plan-box').style.display = 'block';
    setStatus('', false, false);
    document.getElementById('plan-btn').disabled = false;
  }).catch(function (err) {
    setStatus('Error: ' + err.message, true, false);
    document.getElementById('plan-btn').disabled = false;
  });
}

function approve() {
  setStatus('Drafting content...', false, true);
  document.getElementById('approve-btn').disabled = true;

  apiCall('/api/generateContent', { request: currentRequest, attachments: attachments, outputType: outputType }).then(function (result) {
    lastResult = result;
    setStatus('Inserting into your ' + HOST_META[outputType].badge + '...', false, true);
    return insertIntoDocument(result);
  }).then(function () {
    document.getElementById('result-summary').textContent = lastResult.summary;
    document.getElementById('result-box').style.display = 'block';
    setStatus('', false, false);
    document.getElementById('approve-btn').disabled = false;
  }).catch(function (err) {
    setStatus('Error: ' + err.message, true, false);
    document.getElementById('approve-btn').disabled = false;
  });
}

// --- Office.js insertion --------------------------------------------

function insertIntoDocument(result) {
  if (outputType === 'document') {
    return insertDocument(result.parsed);
  }
  if (outputType === 'spreadsheet') {
    return insertSpreadsheet(result.parsed);
  }
  return insertPresentation(result.pptxBase64);
}

function insertDocument(parsed) {
  return Word.run(function (context) {
    var body = context.document.body;
    var title = body.insertParagraph(parsed.title, Word.InsertLocation.end);
    title.styleBuiltIn = Word.BuiltInStyleName.title;
    parsed.sections.forEach(function (section) {
      if (section.heading) {
        var heading = body.insertParagraph(section.heading, Word.InsertLocation.end);
        heading.styleBuiltIn = Word.BuiltInStyleName.heading2;
      }
      if (section.body) {
        body.insertParagraph(section.body, Word.InsertLocation.end);
      }
    });
    return context.sync();
  });
}

function insertSpreadsheet(parsed) {
  return Excel.run(function (context) {
    var sheet = context.workbook.worksheets.getActiveWorksheet();
    var data = [parsed.headers].concat(parsed.rows);
    var range = sheet.getRangeByIndexes(0, 0, data.length, parsed.headers.length);
    range.values = data;
    var headerRange = sheet.getRangeByIndexes(0, 0, 1, parsed.headers.length);
    headerRange.format.font.bold = true;
    range.format.autofitColumns();
    return context.sync();
  });
}

/**
 * PowerPoint has no direct "write these slides" API the way Word/Excel
 * let you write paragraphs/cells — so the server built a real themed
 * .pptx (content.js, reusing the same pptxgenjs writer as desktop-app)
 * and this merges it into the open presentation via
 * insertSlidesFromBase64. UNVERIFIED: this method/enum signature is
 * written from documentation knowledge, not tested against a live
 * PowerPoint host — this sandbox has no Office application to run it in.
 * If sideloading shows an API mismatch, check the current
 * PowerPoint.Presentation.insertSlidesFromBase64 reference and adjust
 * the options object accordingly.
 */
function insertPresentation(pptxBase64) {
  return PowerPoint.run(function (context) {
    context.presentation.insertSlidesFromBase64(pptxBase64, {
      formatting: PowerPoint.InsertSlideFormatting.UseDestinationTheme
    });
    return context.sync();
  });
}

// --- settings ---------------------------------------------------------

function toggleSettings() {
  var box = document.getElementById('settings-box');
  var opening = box.style.display !== 'block';
  box.style.display = opening ? 'block' : 'none';
  if (opening) loadSettings();
}

function loadSettings() {
  apiCall('/api/settings').then(function (settings) {
    document.getElementById('setting-provider').value = settings.LLM_PROVIDER || 'claude';
    document.getElementById('setting-api-key').value = settings.ANTHROPIC_API_KEY || '';
    document.getElementById('setting-ollama-url').value = settings.OLLAMA_URL || '';
  });
}

function saveSettings() {
  var settings = {
    LLM_PROVIDER: document.getElementById('setting-provider').value,
    ANTHROPIC_API_KEY: document.getElementById('setting-api-key').value.trim(),
    OLLAMA_URL: document.getElementById('setting-ollama-url').value.trim()
  };
  apiCall('/api/settings', settings).then(function () {
    toggleSettings();
    refreshProviderStatus();
  });
}

function refreshProviderStatus() {
  apiCall('/api/settings').then(function (settings) {
    var provider = settings.LLM_PROVIDER || 'claude';
    var el = document.getElementById('provider-status');
    if (provider === 'ollama') {
      el.textContent = 'Using local Ollama (' + (settings.OLLAMA_URL || 'http://localhost:11434/v1/chat/completions') + ')';
    } else {
      el.textContent = settings.ANTHROPIC_API_KEY ? 'Using Claude API' : 'Using Claude API — no API key set yet, open Settings';
    }
  });
}
