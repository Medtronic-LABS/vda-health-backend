/* eslint-disable @typescript-eslint/no-unsafe-return */
import { FindManyOptions, FindOneOptions } from 'typeorm';

export interface TenantScopedEntity {
  tenantId: string;
}

export function enforceTenantFindMany<T extends TenantScopedEntity>(
  tenantId: string,
  options: FindManyOptions<T> = {},
): FindManyOptions<T> {
  const existingWhere = options.where || {};
  const newWhere = Array.isArray(existingWhere)
    ? existingWhere.map((cond) => ({ ...cond, tenantId }))
    : { ...existingWhere, tenantId };

  return {
    ...options,
    where: newWhere,
  } as unknown as FindManyOptions<T>;
}

export function enforceTenantFindOne<T extends TenantScopedEntity>(
  tenantId: string,
  options: FindOneOptions<T> = {},
): FindOneOptions<T> {
  const existingWhere = options.where || {};
  const newWhere = Array.isArray(existingWhere)
    ? existingWhere.map((cond) => ({ ...cond, tenantId }))
    : { ...existingWhere, tenantId };

  return {
    ...options,
    where: newWhere,
  } as unknown as FindOneOptions<T>;
}
