import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  forgotPasswordSchema,
  hasOuterWhitespace,
  loginSchema,
  passwordSchema,
  type ForgotPasswordInput,
  type LoginInput,
} from '@innovexa/shared';
import { Button } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/misc';
import { api, errorCode, errorDetails, errorMessage, type ApiEnvelope } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import type { User } from '@/types';
import { AuthLayout } from './AuthLayout';
import { PORTAL_HOME, useAuth } from './AuthProvider';

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/**
 * The password is sent exactly as typed (never trimmed). Because the password
 * policy forbids leading/trailing whitespace, a value with outer whitespace can
 * never be correct, so it is caught here before it costs a failed attempt.
 */
const loginFormSchema = loginSchema.extend({
  password: loginSchema.shape.password.refine(
    (v) => !hasOuterWhitespace(v),
    'Your password starts or ends with a space (often from copy-paste or autofill). Remove it and try again.',
  ),
});

function LockedAlert({ error }: { error: unknown }) {
  const until = (errorDetails(error) as { lockedUntil?: string } | undefined)?.lockedUntil;
  return (
    <FormAlert>
      <p className="font-medium">{errorMessage(error)}</p>
      {until && <p className="mt-1">Locked until {formatDateTime(until)}.</p>}
      <p className="mt-1">
        To unlock now,{' '}
        <Link to="/forgot-password" className="font-medium underline">
          reset your password
        </Link>
        . A successful reset unlocks the account.
      </p>
    </FormAlert>
  );
}

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const form = useForm<LoginInput>({ resolver: zodResolver(loginFormSchema) });
  const login = useMutation({
    mutationFn: (input: LoginInput) => api.post<ApiEnvelope<{ user: User }>>('/auth/login', input),
    onSuccess: (res) => {
      const user = res.data.data.user;
      setUser(user);
      const home = PORTAL_HOME[user.role];
      // Return to a deep link only if it is inside this user's own portal.
      const portalRoot = `/${user.role.toLowerCase()}/`;
      navigate(from?.startsWith(portalRoot) ? from : home, { replace: true });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthLayout title="Sign in" subtitle="Access your Innovexa portal.">
      <form
        onSubmit={form.handleSubmit((v) => !login.isPending && login.mutate(v))}
        className="space-y-4"
        noValidate
      >
        {login.isError &&
          (errorCode(login.error) === 'ACCOUNT_LOCKED' ? (
            <LockedAlert error={login.error} />
          ) : (
            <FormAlert>{errorMessage(login.error)}</FormAlert>
          ))}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            aria-invalid={!!errors.email}
            {...form.register('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...form.register('password')}
          />
        </Field>
        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-xs text-slate-500">
        Accounts are created by invitation. Contact your Innovexa administrator for access.
      </p>
    </AuthLayout>
  );
}

const newPasswordForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type NewPasswordForm = z.infer<typeof newPasswordForm>;

function NewPasswordFields({ form }: { form: ReturnType<typeof useForm<NewPasswordForm>> }) {
  const { errors } = form.formState;
  return (
    <>
      <Field
        label="New password"
        htmlFor="password"
        error={errors.password?.message}
        hint="At least 10 characters with upper and lower case letters and a number."
      >
        <PasswordInput
          id="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...form.register('password')}
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <PasswordInput
          id="confirm"
          autoComplete="new-password"
          aria-invalid={!!errors.confirm}
          {...form.register('confirm')}
        />
      </Field>
    </>
  );
}

function InvalidLink({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <FormAlert>{message}</FormAlert>
      <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}

export function AcceptInvitationPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () =>
      (
        await api.get<ApiEnvelope<{ email: string; name: string; role: User['role'] }>>(
          `/auth/invitations/${encodeURIComponent(token)}`,
        )
      ).data.data,
    enabled: token.length > 0,
    retry: false,
  });
  const form = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordForm) });
  const accept = useMutation({
    mutationFn: (password: string) =>
      api.post<ApiEnvelope<{ user: User }>>('/auth/accept-invitation', { token, password }),
    onSuccess: (res) => {
      setUser(res.data.data.user);
      navigate(PORTAL_HOME[res.data.data.user.role], { replace: true });
    },
  });

  return (
    <AuthLayout
      title="Activate your account"
      subtitle="Set a password to finish joining Innovexa Digital."
    >
      {!token ? (
        <InvalidLink message="This invitation link is incomplete." />
      ) : invitation.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : invitation.isError ? (
        <InvalidLink message={errorMessage(invitation.error)} />
      ) : (
        <form
          onSubmit={form.handleSubmit((v) => accept.mutate(v.password))}
          className="space-y-4"
          noValidate
        >
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm">
            <div className="font-medium text-slate-900">{invitation.data!.name}</div>
            <div className="text-slate-600">{invitation.data!.email}</div>
            <div className="mt-1 text-xs font-medium text-brand-700">
              {humanize(invitation.data!.role)} portal
            </div>
          </div>
          {accept.isError && <FormAlert>{errorMessage(accept.error)}</FormAlert>}
          <NewPasswordFields form={form} />
          <Button type="submit" className="w-full" size="lg" loading={accept.isPending}>
            Activate account
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });
  const request = useMutation({
    mutationFn: (v: ForgotPasswordInput) => api.post('/auth/forgot-password', v),
  });
  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to choose a new password."
    >
      {request.isSuccess ? (
        <div className="space-y-4">
          <FormAlert tone="success">
            If an account exists for that email, a reset link has been sent.
          </FormAlert>
          <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit((v) => request.mutate(v))}
          className="space-y-4"
          noValidate
        >
          {request.isError && <FormAlert>{errorMessage(request.error)}</FormAlert>}
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register('email')}
            />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={request.isPending}>
            Send reset link
          </Button>
          <Link
            to="/login"
            className="block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const form = useForm<NewPasswordForm>({ resolver: zodResolver(newPasswordForm) });
  const reset = useMutation({
    mutationFn: (password: string) => api.post('/auth/reset-password', { token, password }),
  });
  return (
    <AuthLayout title="Choose a new password">
      {!token ? (
        <InvalidLink message="This reset link is incomplete." />
      ) : reset.isSuccess ? (
        <div className="space-y-4">
          <FormAlert tone="success">
            Your password has been updated. All other sessions were signed out.
          </FormAlert>
          <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={form.handleSubmit((v) => reset.mutate(v.password))}
          className="space-y-4"
          noValidate
        >
          {reset.isError && <FormAlert>{errorMessage(reset.error)}</FormAlert>}
          <NewPasswordFields form={form} />
          <Button type="submit" className="w-full" size="lg" loading={reset.isPending}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const verify = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => api.post('/auth/verify-email', { token }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  return (
    <AuthLayout title="Email verification">
      {!token || verify.isError ? (
        <InvalidLink
          message={token ? errorMessage(verify.error) : 'This verification link is incomplete.'}
        />
      ) : verify.isSuccess ? (
        <div className="space-y-4">
          <FormAlert tone="success">Your email address is verified.</FormAlert>
          <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
            Continue
          </Link>
        </div>
      ) : (
        <Skeleton className="h-12" />
      )}
    </AuthLayout>
  );
}
