'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { MessageCategory, MessageTemplate, Workspace } from '@/lib/types';

const SHORTCODES = ['{name}', '{business}', '{company}', '{email}', '{website}', '{domain}', '{phone}', '{category}', '{industry}', '{location}', '{source}'];
const DEFAULT_MESSAGE = `Hi {name},\n\nI found {business} while reviewing {category} businesses.\n\nWould you like me to send a short, practical idea for improving {business}?\n\nBest regards,\nOlalekan`;

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

export default function TemplateLibraryClient({ workspace }: { workspace: Workspace }) {
  const supabase = useMemo(() => createClient(), []);
  const [categories, setCategories] = useState<MessageCategory[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('Shopify marketing scouting');
  const [categoryDescription, setCategoryDescription] = useState('Messages for this scouting angle.');
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('First message');
  const [subject, setSubject] = useState('{name}, quick question');
  const [subjectVariants, setSubjectVariants] = useState('{business}, quick idea\nQuick idea for {name}');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [status, setStatus] = useState('Create categories, then save multiple templates inside each category.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const categoryTemplates = templates.filter((t) => !categoryId || t.category_id === categoryId);

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

  function loadTemplate(template: MessageTemplate) {
    setTemplateId(template.id);
    setTemplateName(template.name);
    setSubject(template.subject);
    setSubjectVariants((template.subject_variants || []).join('\n'));
    setMessage(template.message);
    if (template.category_id) setCategoryId(template.category_id);
  }

  function onCategoryChange(id: string) {
    setCategoryId(id);
    const cat = categories.find((c) => c.id === id);
    if (cat) {
      setCategoryName(cat.name);
      setCategoryDescription(cat.description || '');
    }
    const first = templates.find((t) => t.category_id === id);
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

  async function saveNewTemplate() {
    setBusy(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const category = await ensureCategory();
      const payload = {
        workspace_id: workspace.id,
        category_id: category?.id || null,
        category_name: category?.name || categoryName.trim() || null,
        name: templateName.trim() || 'Untitled template',
        subject: subject.trim(),
        subject_variants: subjectVariants.split('\n').map((s) => s.trim()).filter(Boolean),
        message: message.trim(),
        active: true,
        created_by: user.id
      };
      if (!payload.subject || !payload.message) throw new Error('Subject and message are required.');
      const { data, error: insertError } = await supabase.from('templates').insert(payload).select('*').single();
      if (insertError) throw insertError;
      setTemplateId(data.id);
      setStatus('Template saved.');
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
      const category = await ensureCategory();
      const { error: updateError } = await supabase.from('templates').update({
        category_id: category?.id || null,
        category_name: category?.name || null,
        name: templateName.trim() || 'Untitled template',
        subject: subject.trim(),
        subject_variants: subjectVariants.split('\n').map((s) => s.trim()).filter(Boolean),
        message: message.trim(),
        updated_at: new Date().toISOString()
      }).eq('workspace_id', workspace.id).eq('id', templateId);
      if (updateError) throw updateError;
      setStatus('Template updated.');
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

      <div className="grid grid-3">
        <div className="card kpi"><div className="title">Categories</div><div className="num">{categories.length}</div></div>
        <div className="card kpi"><div className="title">Templates</div><div className="num">{templates.length}</div></div>
        <div className="card kpi"><div className="title">In Selected Category</div><div className="num">{categoryTemplates.length}</div></div>
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
          <h3>Available Shortcodes</h3>
          <p className="muted">Use these inside subjects and messages. Scout replaces them for each business before sending.</p>
          <div className="notice">{SHORTCODES.map((s) => <code key={s}>{s}</code>)}</div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 18 }}>
          <h3>Template Editor</h3>
          <div className="grid grid-2">
            <div>
              <label className="label">Template</label>
              <select className="select" value={templateId} onChange={(e) => { const t = templates.find((row) => row.id === e.target.value); if (t) loadTemplate(t); else setTemplateId(''); }}>
                <option value="">New template</option>
                {categoryTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Template name</label>
              <input className="input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
          </div>
          <label className="label" style={{ marginTop: 12 }}>Primary subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label className="label" style={{ marginTop: 12 }}>Extra subject variants, one per line</label>
          <textarea className="textarea" style={{ minHeight: 70 }} value={subjectVariants} onChange={(e) => setSubjectVariants(e.target.value)} />
          <label className="label" style={{ marginTop: 12 }}>Message</label>
          <textarea className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} />
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" disabled={busy} onClick={saveNewTemplate}>Save New Template</button>
            <button className="btn secondary" type="button" disabled={busy || !templateId} onClick={updateTemplate}>Update Selected</button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h3>Templates in this Category</h3>
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Subject</th><th>Action</th></tr></thead><tbody>
            {categoryTemplates.map((t) => <tr key={t.id}><td><strong>{t.name}</strong><br /><span className="muted">{t.category_name || 'No category'}</span></td><td>{t.subject}</td><td><button className="btn secondary" type="button" onClick={() => loadTemplate(t)}>Open</button> <button className="btn secondary" type="button" onClick={() => archiveTemplate(t.id)}>Archive</button></td></tr>)}
            {!categoryTemplates.length ? <tr><td colSpan={3} className="muted">No templates in this category yet.</td></tr> : null}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}
