import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PRIORITIES, Priority } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/extra';
import { Field, FormAlert, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/misc';
import { errorMessage, getData, postData } from '@/lib/api';
import { fromDateInput } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import type { Milestone, Task } from '@/types';
import { usePartnerOptions, useProjectOptions } from './options';

/** Multi-select of active partners as a checkbox list (accessible, works on mobile). */
export function PartnerPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const partners = usePartnerOptions();
  if (partners.isLoading) return <p className="text-sm text-slate-500">Loading partners…</p>;
  if (!partners.data?.length)
    return <p className="text-sm text-slate-500">No active partners yet. Add partners first.</p>;
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {partners.data.map((p) => (
        <label
          key={p.id}
          className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
        >
          <input
            type="checkbox"
            checked={value.includes(p.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, p.id] : value.filter((v) => v !== p.id))
            }
          />
          <span className="text-slate-800">{p.name}</span>
          <span className="text-xs text-slate-500">
            {p.partnerProfile ? humanize(p.partnerProfile.partnerType) : ''}
          </span>
        </label>
      ))}
    </div>
  );
}

export function TaskFormDialog({
  open,
  onClose,
  projectId: fixedProject,
  assigneeId,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  assigneeId?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useProjectOptions();
  const [form, setForm] = useState({
    projectId: fixedProject ?? '',
    milestoneId: '',
    title: '',
    description: '',
    instructions: '',
    expectedDeliverables: '',
    priority: Priority.MEDIUM as string,
    startDate: '',
    dueDate: '',
    estimatedHours: '',
    weight: '1',
  });
  const [assignees, setAssignees] = useState<string[]>(assigneeId ? [assigneeId] : []);
  useEffect(() => {
    if (open) setAssignees(assigneeId ? [assigneeId] : []);
  }, [open, assigneeId]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const milestones = useQuery({
    queryKey: ['milestones', form.projectId],
    queryFn: async () =>
      (await getData<Milestone[]>(`/projects/${form.projectId}/milestones`)).data,
    enabled: !!form.projectId,
  });

  const create = useMutation({
    mutationFn: () =>
      postData<Task>('/tasks', {
        projectId: form.projectId,
        title: form.title,
        ...(form.milestoneId && { milestoneId: form.milestoneId }),
        ...(form.description && { description: form.description }),
        ...(form.instructions && { instructions: form.instructions }),
        ...(form.expectedDeliverables && { expectedDeliverables: form.expectedDeliverables }),
        priority: form.priority,
        ...(form.startDate && { startDate: fromDateInput(form.startDate) }),
        ...(form.dueDate && { dueDate: fromDateInput(form.dueDate) }),
        ...(form.estimatedHours && { estimatedHours: Number(form.estimatedHours) }),
        weight: Number(form.weight) || 1,
        assigneeIds: assignees,
      }),
    onSuccess: (task) => {
      toast.success(assignees.length ? 'Task created and assigned' : 'Task created');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      navigate(`/admin/tasks/${task.id}`);
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create task"
      description="Assign work to one or more partners."
      className="sm:max-w-2xl"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {create.isError && <FormAlert>{errorMessage(create.error)}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor="t-project">
            <Select
              id="t-project"
              required
              value={form.projectId}
              onChange={set('projectId')}
              disabled={!!fixedProject}
            >
              <option value="">Select a project…</option>
              {projects.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectCode} · {p.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Milestone (optional)" htmlFor="t-ms">
            <Select
              id="t-ms"
              value={form.milestoneId}
              onChange={set('milestoneId')}
              disabled={!form.projectId}
            >
              <option value="">None</option>
              {milestones.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Title" htmlFor="t-title">
          <Input
            id="t-title"
            required
            minLength={2}
            maxLength={150}
            value={form.title}
            onChange={set('title')}
          />
        </Field>
        <Field label="Description" htmlFor="t-desc">
          <Textarea
            id="t-desc"
            value={form.description}
            onChange={set('description')}
            maxLength={5000}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instructions" htmlFor="t-instr">
            <Textarea
              id="t-instr"
              value={form.instructions}
              onChange={set('instructions')}
              maxLength={5000}
            />
          </Field>
          <Field label="Expected deliverables" htmlFor="t-deliv">
            <Textarea
              id="t-deliv"
              value={form.expectedDeliverables}
              onChange={set('expectedDeliverables')}
              maxLength={2000}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Priority" htmlFor="t-prio">
            <Select id="t-prio" value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="t-start">
            <Input id="t-start" type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Target completion" htmlFor="t-due">
            <Input id="t-due" type="date" value={form.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label="Estimated hours" htmlFor="t-hours">
            <Input
              id="t-hours"
              type="number"
              min={0}
              step="0.5"
              value={form.estimatedHours}
              onChange={set('estimatedHours')}
            />
          </Field>
          <Field label="Weight (1–100)" htmlFor="t-weight" hint="Share of project progress">
            <Input
              id="t-weight"
              type="number"
              min={1}
              max={100}
              step={1}
              value={form.weight}
              onChange={set('weight')}
            />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-700">Assign partners</div>
          <PartnerPicker value={assignees} onChange={setAssignees} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={create.isPending}
            disabled={!form.projectId || form.title.trim().length < 2}
          >
            Create task
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
