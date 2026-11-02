import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, Printer, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { InvoiceStatus, Role } from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { StatusBadge, TableShell, td, th } from '@/components/ui/extra';
import { FormAlert } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage, getData, postData } from '@/lib/api';
import { money } from '@/lib/format';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import type { Invoice, Payment } from '@/types';

const KIND_LABEL = { ADVANCE: 'Advance', INSTALLMENT: 'Instalment', BALANCE: 'Balance' } as const;

export function InvoiceSummary({ invoice }: { invoice: Invoice }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['Invoice total', money(invoice.totalMinor)],
        ['Advance paid', `${money(invoice.advancePaidMinor)} of ${money(invoice.advanceMinor)}`],
        ['Total paid', money(invoice.paidMinor)],
        ['Remaining balance', money(Math.max(0, invoice.balanceMinor))],
      ].map(([k, v]) => (
        <div key={k} className="rounded-lg bg-slate-50 px-3 py-2.5">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ScheduleTable({ invoice }: { invoice: Invoice }) {
  return (
    <TableShell minWidth={560}>
      <thead>
        <tr>
          <th className={th}>#</th>
          <th className={th}>Type</th>
          <th className={th}>Due date</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={`${th} text-right`}>Paid</th>
          <th className={th}>Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {invoice.installments.map((i) => (
          <tr key={i.id}>
            <td className={td}>{i.number}</td>
            <td className={td}>{KIND_LABEL[i.kind]}</td>
            <td className={td}>{formatDate(i.dueDate)}</td>
            <td className={`${td} text-right tabular-nums`}>{money(i.amountMinor)}</td>
            <td className={`${td} text-right tabular-nums`}>{money(i.paidMinor)}</td>
            <td className={td}>
              <StatusBadge status={i.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function PaymentsTable({
  payments,
  receiptBase,
}: {
  payments: Payment[];
  receiptBase: string;
}) {
  if (!payments.length)
    return (
      <EmptyState
        icon={<Receipt />}
        title="No payments yet"
        description="Recorded payments and receipts appear here."
      />
    );
  return (
    <TableShell minWidth={640}>
      <thead>
        <tr>
          <th className={th}>Date</th>
          <th className={th}>Invoice</th>
          <th className={th}>Method</th>
          <th className={th}>Reference</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={th}>Status</th>
          <th className={th} />
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {payments.map((p) => (
          <tr key={p.id}>
            <td className={td}>{formatDate(p.paidAt ?? p.createdAt)}</td>
            <td className={td}>{typeof p.invoice === 'object' ? p.invoice?.invoiceNumber : '—'}</td>
            <td className={td}>
              {humanize(p.method)}
              {p.isAdvance && <span className="ml-1 text-xs text-slate-500">(advance)</span>}
            </td>
            <td className={`${td} font-mono text-xs`}>{p.reference ?? '—'}</td>
            <td className={`${td} text-right tabular-nums`}>{money(p.amountMinor)}</td>
            <td className={td}>
              <StatusBadge status={p.status} />
              {p.failureReason && <div className="text-xs text-red-600">{p.failureReason}</div>}
            </td>
            <td className={`${td} text-right`}>
              {p.receiptNumber && (
                <Link
                  to={`${receiptBase}/${p.id}`}
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Receipt
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/* ----------------------------- Razorpay checkout ----------------------------- */

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window'));
    document.body.appendChild(s);
  });
}

function PayOnlineButton({ invoice }: { invoice: Invoice }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const config = useQuery({
    queryKey: ['payments', 'config'],
    queryFn: async () => (await getData<{ enabled: boolean }>('/payments/config')).data,
    staleTime: Infinity,
  });
  const pay = useMutation({
    mutationFn: async () => {
      const order = await postData<{
        orderId: string;
        amountMinor: number;
        currency: string;
        keyId: string;
        invoiceNumber: string;
      }>('/payments/orders', { invoiceId: invoice.id });
      await loadCheckout();
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: order.keyId,
          order_id: order.orderId,
          amount: order.amountMinor,
          currency: order.currency,
          name: 'Innovexa Digital',
          description: `Invoice ${order.invoiceNumber}`,
          prefill: { name: user?.name, email: user?.email },
          theme: { color: '#1d40d8' },
          handler: (resp: Record<string, string>) =>
            postData('/payments/verify', resp).then(() => resolve(), reject),
          modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
        });
        rzp.open();
      });
    },
    onSuccess: () => {
      toast.success('Payment received. Thank you!');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e) =>
      toast.error(e instanceof Error && !('isAxiosError' in e) ? e.message : errorMessage(e)),
  });
  if (!config.data?.enabled || !invoice.nextDue) return null;
  return (
    <Button onClick={() => pay.mutate()} loading={pay.isPending}>
      <CreditCard /> Pay {money(invoice.nextDue.dueMinor)} online
    </Button>
  );
}

/** Invoice detail used by both admin and client portals. `adminActions` renders extra controls. */
export function InvoiceDetailPage({
  adminActions,
}: {
  adminActions?: (invoice: Invoice) => React.ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const base = user?.role === Role.ADMIN ? '/admin' : '/client';
  const invoice = useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => (await getData<Invoice>(`/invoices/${id}`)).data,
  });

  if (invoice.isLoading) return <Skeleton className="h-64" />;
  if (invoice.isError) return <FormAlert>{errorMessage(invoice.error)}</FormAlert>;
  const inv = invoice.data!;
  const payable = [
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
  ].includes(inv.status as never);

  return (
    <>
      <Link
        to={`${base}/invoices`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Invoices
      </Link>
      <PageHeader
        title={`Invoice ${inv.invoiceNumber}`}
        description={`${inv.project?.projectCode ?? ''} ${inv.project?.title ?? ''} · ${inv.client?.companyName ?? ''}`}
        actions={
          <>
            <StatusBadge status={inv.status} />
            {user?.role === Role.CLIENT && payable && <PayOnlineButton invoice={inv} />}
            {adminActions?.(inv)}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <Card className="p-5">
          <InvoiceSummary invoice={inv} />
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Invoice date</dt>
              <dd>{formatDate(inv.invoiceDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Final due date</dt>
              <dd>{formatDate(inv.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Payment terms</dt>
              <dd>{humanize(inv.paymentTerms)}</dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Contract amount</span>
              <span className="tabular-nums">{money(inv.contractAmountMinor)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Tax</span>
              <span className="tabular-nums">{money(inv.taxMinor)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Discount</span>
              <span className="tabular-nums">−{money(inv.discountMinor)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(inv.totalMinor)}</span>
            </div>
          </div>
          {inv.notes && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{inv.notes}</p>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Payment schedule"
            description={
              inv.paymentTerms === 'INSTALLMENTS'
                ? 'Instalment plan agreed with Innovexa (not bank/card EMI financing).'
                : undefined
            }
          />
          <ScheduleTable invoice={inv} />
        </Card>
        <Card>
          <CardHeader title="Payments" />
          <PaymentsTable payments={inv.payments ?? []} receiptBase={`${base}/receipts`} />
        </Card>
      </div>
    </>
  );
}

export function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useQuery({
    queryKey: ['receipts', id],
    queryFn: async () =>
      (
        await getData<
          Payment & {
            invoice: {
              invoiceNumber: string;
              totalMinor: number;
              paidMinor: number;
              balanceMinor: number;
              projectId?: { title: string; projectCode: string };
            };
            client: {
              companyName: string;
              contactName: string;
              email: string;
              gstin?: string;
              address?: { city?: string; state?: string };
            };
          }
        >(`/payments/${id}/receipt`)
      ).data,
  });
  if (receipt.isLoading) return <Skeleton className="h-96" />;
  if (receipt.isError) return <FormAlert>{errorMessage(receipt.error)}</FormAlert>;
  const r = receipt.data!;
  return (
    <>
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.history.back()}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print / save as PDF
        </Button>
      </div>
      <Card className="mx-auto max-w-2xl p-8 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between">
          <Logo size="md" />
          <div className="text-right">
            <div className="text-lg font-semibold text-slate-900">Payment receipt</div>
            <div className="font-mono text-sm text-slate-600">{r.receiptNumber}</div>
          </div>
        </div>
        <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase text-slate-500">Received from</div>
            <div className="mt-1 font-medium text-slate-900">{r.client.companyName}</div>
            <div className="text-slate-600">{r.client.contactName}</div>
            <div className="text-slate-600">{r.client.email}</div>
            {r.client.gstin && <div className="text-slate-600">GSTIN {r.client.gstin}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-xs font-medium uppercase text-slate-500">Details</div>
            <div className="mt-1">Date: {formatDateTime(r.paidAt)}</div>
            <div>Invoice: {r.invoice.invoiceNumber}</div>
            {r.invoice.projectId && (
              <div>
                Project: {r.invoice.projectId.projectCode} {r.invoice.projectId.title}
              </div>
            )}
            <div>Method: {humanize(r.method)}</div>
            {r.reference && <div className="font-mono text-xs">Ref: {r.reference}</div>}
          </div>
        </div>
        <div className="mt-8 rounded-xl bg-brand-50 px-5 py-4 text-center">
          <div className="text-xs uppercase tracking-wide text-brand-700">Amount received</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-navy-900">
            {money(r.amountMinor)}
          </div>
          {r.isAdvance && (
            <div className="mt-1 text-xs text-brand-700">Includes advance payment</div>
          )}
        </div>
        <div className="mt-6 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice total</span>
            <span className="tabular-nums">{money(r.invoice.totalMinor)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Balance after all recorded payments</span>
            <span className="tabular-nums">{money(Math.max(0, r.invoice.balanceMinor))}</span>
          </div>
        </div>
        <p className="mt-10 text-center text-xs text-slate-400">
          This is a computer-generated receipt from Innovexa Digital.
        </p>
      </Card>
    </>
  );
}

export function PaymentHistoryPage() {
  const { user } = useAuth();
  const base = user?.role === Role.ADMIN ? '/admin' : '/client';
  const payments = useQuery({
    queryKey: ['payments', 'history'],
    queryFn: async () => (await getData<Payment[]>('/payments', { limit: 100 })).data,
  });
  return (
    <>
      <PageHeader
        title="Payment history"
        description="All recorded payments with downloadable receipts."
      />
      <Card>
        {payments.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : payments.isError ? (
          <div className="p-4">
            <FormAlert>{errorMessage(payments.error)}</FormAlert>
          </div>
        ) : (
          <PaymentsTable payments={payments.data!} receiptBase={`${base}/receipts`} />
        )}
      </Card>
    </>
  );
}

export function useInvoiceAction(id: string, path: 'issue' | 'cancel') {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const m = useMutation({
    mutationFn: () => postData(`/invoices/${id}/${path}`),
    onSuccess: () => {
      toast.success(
        path === 'issue' ? 'Invoice issued and sent to the client' : 'Invoice cancelled',
      );
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { ...m, confirming, setConfirming };
}
