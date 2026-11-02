import { useQuery } from '@tanstack/react-query';
import { getData } from '@/lib/api';
import type { ClientRecord, Project, ServiceCategory, User } from '@/types';

/** Lookup lists for admin forms (cached for a minute). */
export const usePartnerOptions = () =>
  useQuery({
    queryKey: ['options', 'partners'],
    queryFn: async () =>
      (await getData<User[]>('/users', { role: 'PARTNER', status: 'ACTIVE', limit: 100 })).data,
    staleTime: 60_000,
  });

export const useClientOptions = () =>
  useQuery({
    queryKey: ['options', 'clients'],
    queryFn: async () =>
      (await getData<ClientRecord[]>('/clients', { status: 'ACTIVE', limit: 100 })).data,
    staleTime: 60_000,
  });

export const useCategoryOptions = () =>
  useQuery({
    queryKey: ['options', 'categories'],
    queryFn: async () => (await getData<ServiceCategory[]>('/service-categories')).data,
    staleTime: 60_000,
  });

export const useProjectOptions = () =>
  useQuery({
    queryKey: ['options', 'projects'],
    queryFn: async () => (await getData<Project[]>('/projects', { limit: 100 })).data,
    staleTime: 30_000,
  });
