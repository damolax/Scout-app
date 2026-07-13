'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { MessageCategory, MessageTemplate, TemplateAttachment, Workspace } from '@/lib/types';

const SHORTCODES = ['{name}', '{business}', '{company}', '{email}', '{website}', '{domain}', '{phone}', '{category}', '{industry}', '{location}', '{source}', '{last_subject}', '{last_message}', '{reply_snippet}', '{reply_type}'];
const DEFAULT_INITIAL = `Hi {name},\n\nI found {business} while reviewing {category} businesses.\n\nWould you like me to send a short, practical idea for improving {business}?\n\nBest regards,\nOlalekan`;
const DEFAULT_FOLLOW_UP = `Hi {name},\n\nJust following up on my earlier message about {business}.\n\nWould it be useful if I sent the 2-3 practical improvements I noticed?\n\nBest regards,\nOlalekan`;
const DEFAULT_REPLY = `Hi {name},\n\nThanks for getting back to me.\n\nThat makes sense. Based on what you said, I can send a short practical breakdown for {business}.\n\nBest regards,\nOlalekan`;

type TemplateType = 'initial' | 'follow_up' | 'reply';

function formatError(error: unknown) {
  if (!error) return 'Unknown error.';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    const value = error as { message?: string; code?: string; details?: string; hint?: string; error?: string };
    return [value.message || value.error, value.code ? `Code: ${value.code}` : '', value.details, value.hint].filter(Boolean).join(' | ') || JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function typeLabel(type: string | null | undefined) {
  if (type === 'reply') return 'Reply template';
  if (type === 'follow_up') return 'Follow-up template';
  return 'Initial message template';
}

function defaultBody(type: TemplateType) {
  if (type === 'reply') return DEFAULT_REPLY;
  if (type === 'follow_up') return DEFAULT_FOLLOW_UP;
  return DEFAULT_INITIAL;
}

function defaultSubject(type: TemplateType) {
  if (type === 'reply') return 'Re: {last_subject}';
  if (type === 'follow_up') return 'Re: quick idea for {business}';
  return '{name}, quick question';
}

function templateAttachments(template: MessageTemplate): TemplateAttachment[] {
  const direct = Array.isArray((template as any).attachments) ? ((template as any).attachments as TemplateAttachment[]) : [];
  const raw = (template as any).raw && Array.isArray((template as any).raw.attachments) ? ((template as any).raw.attachments as TemplateAttachment[]) : [];
  return direct.length ? direct : raw;
}

function attachmentLabel(attachment: TemplateAttachment) {
  const size = Number(attachment.size_bytes || 0);
  const sizeText = size > 0 ? ` · ${(size / 1024 / 1024).toFixed(size > 1024 * 1024 ? 1 : 2)} MB` : '';
  return `${attachment.name || attachment.filename || 'Attachment'}${sizeText}`;
}

export default function TemplateLibraryClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('Shopify marketing scouting');
  const [categoryDescription, setCategoryDescription] = useState('Messages for this scouting angle.');
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('First message');
  const [templateType, setTemplateType] = useState<TemplateType>('initial');
  const [purpose, setPurpose] = useState('');
  const [replyContext, setReplyContext] = useState('');
  const [subject, setSubject] = useState(defaultSubject('initial'));
  const [subjectVariants, setSubjectVariants] = useState('{business}, quick idea\nQuick idea for {name}');
  const [message, setMessage] = useState(DEFAULT_INITIAL);
  const [attachments, setAttachments] = useState<TemplateAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TemplateType>('all');
  const [status, setStatus] = useState('Create initial, follow-up, and reply-only templates. Reply templates cannot be used for first-message batches.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryTemplates = templates.filter((t) => (!categoryId || t.category_id === categoryId) && (typeFilter === 'all' || (t.template_type || 'initial') === typeFilter));
  const initialCount = templates.filter((t) => (t.template_type || 'initial') === 'initial').length;
  const followCount = templates.filter((t) => t.template_type === 'follow_up').length;
  const replyCount = templates.filter((t) => t.template_type === 'reply').length;

  async function loadAll() {
    setError('');
    const [categoryResult, templateResult] = await Promise.all([
      supabase.from('message_categories').select('*').eq('workspace_id', workspace.id).eq('active', true).order('name', { ascending: true }),
      supabase.from('templates').select('*').eq('workspace_id', workspace.id).eq('active', true).order('created_at', { ascending: false })
    ]);
    if (categoryResult.error) throw categoryResult.error;
    if (templateResult.error) throw templateResult.error;
    const cats = (categoryResult.data || []) as MessageCategory[];
    const temps = (templateResult.data || []) as MessageTemplate[];
    setCategories(cats);
    setTemplates(temps);
    if (!categoryId && cats[0]) setCategoryId(cats[0].id);
  }

  useEffect(() => {
    loadAll().catch((err) => setError(formatError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  function setNewTemplate(type: TemplateType = templateType) {
    setTemplateId('');
    setTemplateType(type);
    setTemplateName(type === 'reply' ? 'Reply template' : type === 'follow_up' ? 'Follow-up message' : 'First message');
    setSubject(defaultSubject(type));
    setSubjectVariants(type === 'reply' ? 'Re: {business}\nRe: {last_subject}' : type === 'follow_up' ? 'Following up on {business}\nRe: quick idea for {business}' : '{business}, quick idea\nQuick idea for {name}');
    setMessage(defaultBody(type));
    setAttachments([]);
    setAttachmentStatus('');
    setPurpose(type === 'reply' ? 'Use only when replying from a business conversation.' : type === 'follow_up' ? 'Use for businesses with inbox but no reply yet.' : 'Use only for first outreach messages.');
    setReplyContext(type === 'reply' ? 'Useful after a real buyer reply or an auto-responder follow-up.' : '');
  }

  function loadTemplate(template: MessageTemplate) {
    const type = (template.template_type || 'initial') as TemplateType;
    setTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateType(type);
    setPurpose(template.purpose || '');
    setReplyContext(template.reply_context || '');
    setSubject(template.subject || defaultSubject(type));
    setSubjectVariants((template.subject_variants || []).join('\n'));
    setMessage(template.message || defaultBody(type));
    setAttachments(templateAttachments(template));
    setAttachmentStatus('');
    if (template.category_id) setCategoryId(template.category_id);
  }

  function onTemplateTypeChange(type: TemplateType) {
    setTemplateType(type);
    if (!templateId) setNewTemplate(type);
  }

  function onCategoryChange(id: string) {
    setCategoryId(id);
    const cat = categories.find((c) => c.id === id);
    if (cat) {
      setCategoryName(cat.name);
      setCategoryDescription(cat.description || '');
    }
    const first = templates.find((t) => t.category_id === id && (typeFilter === 'all' || (t.template_type || 'initial') === typeFilter));
    if (first) loadTemplate(first);
  }

  async function ensureCategory() {
    const name = categoryName.trim();
    if (!name && !categoryId) throw new Error('Category name is required.');
    if (categoryId) return categories.find((c) => c.id === categoryId) || null;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from('message_categories')
      .upsert({ workspace_id: workspace.id, name, description: categoryDescription.trim() || null, active: true, created_by: user?.id || null }, { onConflict: 'workspace_id,name' })
      .select('*')
      .single();
    if (insertError) throw insertError;
    await loadAll();
    setCategoryId(data.id);
    return data as MessageCategory;
  }

  async function saveCategory() {
    setBusy(true);
    setError('');
    try {
      const name = categoryName.trim();
      if (!name) throw new Error('Category name is required.');
      const { data: { user } } = await supabase.auth.getUser();
      if (categoryId) {
        const { error: updateError } = await supabase.from('message_categories').update({ name, description: categoryDescription.trim() || null, updated_at: new Date().toISOString() }).eq('workspace_id', workspace.id).eq('id', categoryId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from('message_categories').upsert({ workspace_id: workspace.id, name, description: categoryDescription.trim() || null, active: true, created_by: user?.id || null }, { onConflict: 'workspace_id,name' });
        if (insertError) throw insertError;
      }
      setStatus('Category saved.');
      await loadAll();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function templatePayload(category: MessageCategory | null, userId?: string | null, extraRaw: Record<string, unknown> = {}) {
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (!cleanSubject || !cleanMessage) throw new Error('Subject and message are required.');
    return {
      workspace_id: workspace.id,
      category_id: category?.id || null,
      category_name: category?.name || categoryName.trim() || null,
      name: templateName.trim() || 'Untitled template',
      subject: cleanSubject,
      subject_variants: subjectVariants.split('\n').map((s) => s.trim()).filter(Boolean),
      message: cleanMessage,
      template_type: templateType,
      purpose: purpose.trim() || null,
      reply_context: templateType === 'reply' ? (replyContext.trim() || null) : null,
      // Store files in raw.attachments so saving works even if the older database has no templates.attachments column.
      raw: { attachments, ...extraRaw },
      active: true,
      created_by: userId || null
    };
  }

  async function uploadAttachment(file: File | null | undefined) {
    if (!file) return;
    setUploadingAttachment(true);
    setAttachmentStatus('Uploading attachment...');
    setError('');
    try {
      if (attachments.length >= 5) throw new Error('Use up to 5 attachments per template.');
      const form = new FormData();
      form.append('workspace_id', workspace.id);
      form.append('template_id', templateId || templateName || 'new-template');
      form.append('attachment', file);
      const response = await fetch('/api/assets/template-attachment-upload', { method: 'POST', body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json?.success === false) throw new Error(json?.error || `Upload failed with HTTP ${response.status}`);
      const next = [...attachments, json.attachment as TemplateAttachment];
      setAttachments(next);
      setAttachmentStatus(`Attached: ${json.attachment?.name || file.name}. Click Save/Update Template.`);
    } catch (err) {
      setError(formatError(err));
      setAttachmentStatus('Attachment upload failed.');
    } finally {
      setUploadingAttachment(false);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_item, i) => i !== index));
    setAttachmentStatus('Attachment removed. Click Save/Update Template.');
  }

  async function saveNewTemplate() {
    setBusy(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const category = await ensureCategory();
      const { data, error: insertError } = await supabase.from('templates').insert(templatePayload(category, user.id)).select('*').single();
      if (insertError) throw insertError;
      setTemplateId(data.id);
      setStatus(`${typeLabel(templateType)} saved.`);
      await loadAll();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateTemplate() {
    if (!templateId) return setError('Select a template to update.');
    setBusy(true);
    setError('');
    try {
      const oldTemplateId = templateId;
      const { data: { user } } = await supabase.auth.getUser();
      const category = await ensureCategory();

      // Updating a template creates a fresh version with a fresh id.
      // This makes performance start from zero for the updated version and hides the old version.
      const { error: archiveError } = await supabase
        .from('templates')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspace.id)
        .eq('id', oldTemplateId);
      if (archiveError) throw archiveError;

      const payload = templatePayload(category, user?.id || null, {
        versioned_from_template_id: oldTemplateId,
        version_created_at: new Date().toISOString(),
        version_note: 'Updated template saved as a new performance version.'
      });
      const { data, error: insertError } = await supabase.from('templates').insert(payload).select('*').single();
      if (insertError) throw insertError;
      setTemplateId(data.id);
      setStatus(`${typeLabel(templateType)} updated as a new template version. Its performance starts from zero. The old version is hidden from performance.`);
      await loadAll();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function archiveTemplate(id: string) {
    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.from('templates').update({ active: false, updated_at: new Date().toISOString() }).eq('workspace_id', workspace.id).eq('id', id);
      if (updateError) throw updateError;
      if (templateId === id) setTemplateId('');
      setStatus('Template archived.');
      await loadAll();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? <div className="error">{error}</div> : null}
      <div className="success">{status}</div>

      <div className="grid grid-4">
        <div className="card kpi"><div className="title">Initial</div><div className="num">{initialCount}</div></div>
        <div className="card kpi"><div className="title">Follow-up</div><div className="num">{followCount}</div></div>
        <div className="card kpi"><div className="title">Reply Only</div><div className="num">{replyCount}</div></div>
        <div className="card kpi"><div className="title">Categories</div><div className="num">{categories.length}</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Category</h3>
          <div className="grid grid-2">
            <div>
              <label className="label">Select category</label>
              <select className="select" value={categoryId} onChange={(e) => onCategoryChange(e.target.value)}>
                <option value="">New category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Category name</label>
              <input className="input" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Shopify marketing scouting" />
            </div>
          </div>
          <label className="label" style={{ marginTop: 12 }}>Category note</label>
          <input className="input" value={categoryDescription} onChange={(e) => setCategoryDescription(e.target.value)} placeholder="What this library is for" />
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => { setCategoryId(''); setCategoryName(''); setCategoryDescription(''); }}>New Category</button>
            <button className="btn" type="button" disabled={busy} onClick={saveCategory}>Save Category</button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Template Rules</h3>
          <p className="muted">Reply-only templates are intentionally hidden from first-message sending. They appear only inside a business conversation when you are replying to a prospect.</p>
          <div className="notice">{SHORTCODES.map((s) => <code key={s}>{s}</code>)}</div>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={() => setNewTemplate('initial')}>New Initial</button>
            <button className="btn secondary" type="button" onClick={() => setNewTemplate('follow_up')}>New Follow-up</button>
            <button className="btn secondary" type="button" onClick={() => setNewTemplate('reply')}>New Reply Template</button>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Template Editor</h3>
          <div className="grid grid-2">
            <div>
              <label className="label">Template filter</label>
              <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | TemplateType)}>
                <option value="all">All types</option>
                <option value="initial">Initial only</option>
                <option value="follow_up">Follow-up only</option>
                <option value="reply">Reply-only</option>
              </select>
            </div>
            <div>
              <label className="label">Open template</label>
              <select className="select" value={templateId} onChange={(e) => { const t = templates.find((row) => row.id === e.target.value); if (t) loadTemplate(t); else setTemplateId(''); }}>
                <option value="">New template</option>
                {categoryTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {typeLabel(t.template_type)}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="label">Template type</label>
              <select className="select" value={templateType} onChange={(e) => onTemplateTypeChange(e.target.value as TemplateType)}>
                <option value="initial">Initial message</option>
                <option value="follow_up">Follow-up automation</option>
                <option value="reply">Reply-only response</option>
              </select>
            </div>
            <div>
              <label className="label">Template name</label>
              <input className="input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
          </div>
          <label className="label" style={{ marginTop: 12 }}>Purpose / when to use</label>
          <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Example: after an auto-responder or after a positive reply" />
          {templateType === 'reply' ? <><label className="label" style={{ marginTop: 12 }}>Reply context note</label><input className="input" value={replyContext} onChange={(e) => setReplyContext(e.target.value)} placeholder="Example: use when buyer asks for examples/pricing" /></> : null}
          <label className="label" style={{ marginTop: 12 }}>Primary subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="label" style={{ marginTop: 12 }}>Extra subject variants, one per line</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={subjectVariants} onChange={(e) => setSubjectVariants(e.target.value)} />
          <label className="label" style={{ marginTop: 12 }}>Message</label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="card" style={{ padding: 14, marginTop: 12, background: 'rgba(255,255,255,0.03)' }}>
            <h4 style={{ marginTop: 0 }}>Attach file to this template</h4>
            <p className="muted">Use this for a guide, PDF, image, or proposal. Keep files small. Attachments can slow sending and may reduce inbox placement, so use them only when needed.</p>
            <input className="input" type="file" accept="application/pdf,image/*,.txt,.csv,.docx,.xlsx,.pptx" disabled={uploadingAttachment || attachments.length >= 5} onChange={(e) => { const file = e.target.files?.[0]; uploadAttachment(file); e.currentTarget.value = ''; }} />
            {attachmentStatus ? <p className="muted" style={{ marginTop: 8 }}>{attachmentStatus}</p> : null}
            {attachments.length ? <div style={{ marginTop: 10 }}>
              {attachments.map((attachment, index) => <div key={`${attachment.public_url || attachment.url}-${index}`} className="notice" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 8 }}>
                <span>{attachmentLabel(attachment)}</span>
                <button className="btn secondary" type="button" disabled={busy} onClick={() => removeAttachment(index)}>Remove</button>
              </div>)}
            </div> : <p className="muted" style={{ marginTop: 8 }}>No attachment on this template.</p>}
          </div>
          {templateType === 'reply' ? <div className="notice" style={{ marginTop: 12 }}>This is reply-only. It will not appear in first-message batch sending. It appears inside Business → Conversation → Reply template.</div> : null}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy} onClick={saveNewTemplate}>Save New Template</button>
            <button className="btn secondary" type="button" disabled={busy || !templateId} onClick={updateTemplate}>Update Selected</button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Templates in this Category</h3>
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Subject</th><th>Files</th><th>Action</th></tr></thead><tbody>
            {categoryTemplates.map((t) => <tr key={t.id}><td><strong>{t.name}</strong><br /><span className="muted">{t.category_name || 'No category'}</span></td><td><span className="badge">{typeLabel(t.template_type)}</span></td><td>{t.subject}</td><td>{templateAttachments(t).length ? `${templateAttachments(t).length} file(s)` : 'None'}</td><td><button className="btn secondary" type="button" onClick={() => loadTemplate(t)}>Open</button> <button className="btn secondary" type="button" onClick={() => archiveTemplate(t.id)}>Archive</button></td></tr>)}
            {!categoryTemplates.length ? <tr><td colSpan={5} className="muted">No templates matching this category/type yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}
