import { TRPCError } from '@trpc/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { defaultCategoriesData } from 'shared/categories';
import { CategoryModel } from '../models/category';
import { invalidateAnalyticsInputs } from '../services/analyticsDataCache';
import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';

const token = z.object({ token: z.string() });
const id = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), 'Invalid Object ID');
const fields = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Invalid color format'),
  isProductive: z.boolean(),
});
const missing = () => new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
async function assertUnique(userId: string, name: string, except?: string) {
  if (await CategoryModel.exists({ userId, name, ...(except ? { _id: { $ne: except } } : {}) })) {
    throw new TRPCError({ code: 'CONFLICT', message: 'A category with this name already exists.' });
  }
}
export const categoryRouter = router({
  createCategory: publicProcedure.input(fields.merge(token)).mutation(async ({ input }) => {
    const { token: session, ...data } = input;
    const userId = verifyToken(session).userId;
    await assertUnique(userId, data.name);
    const created = await CategoryModel.create({ ...data, userId });
    invalidateAnalyticsInputs(userId);
    return created.toJSON();
  }),
  getCategories: publicProcedure.input(token).query(async ({ input }) => {
    const records = await CategoryModel.find({ userId: verifyToken(input.token).userId }).sort({
      createdAt: -1,
    });
    return records.map((record) => record.toJSON());
  }),
  updateCategory: publicProcedure
    .input(fields.partial().merge(token).extend({ id }))
    .mutation(async ({ input }) => {
      const { token: session, id: categoryId, ...data } = input;
      const userId = verifyToken(session).userId;
      const record = await CategoryModel.findOne({ _id: categoryId, userId });
      if (!record) throw missing();
      if (data.name && data.name !== record.name) await assertUnique(userId, data.name, categoryId);
      record.set(data);
      await record.save();
      invalidateAnalyticsInputs(userId);
      return record.toJSON();
    }),
  deleteCategory: publicProcedure.input(token.extend({ id })).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    if (!(await CategoryModel.findOneAndDelete({ _id: input.id, userId }))) throw missing();
    invalidateAnalyticsInputs(userId);
    return { success: true, id: input.id };
  }),
  resetToDefault: publicProcedure.input(token).mutation(async ({ input }) => {
    const userId = verifyToken(input.token).userId;
    await CategoryModel.deleteMany({ userId });
    const defaults = await CategoryModel.insertMany(defaultCategoriesData(userId));
    invalidateAnalyticsInputs(userId);
    return defaults.map((record) => record.toJSON());
  }),
  getCategoryById: publicProcedure
    .input(token.extend({ categoryId: id }))
    .query(async ({ input }) => {
      const record = await CategoryModel.findOne({
        _id: input.categoryId,
        userId: verifyToken(input.token).userId,
      });
      if (!record) throw missing();
      return record.toJSON();
    }),
});
export type CategoryRouter = typeof categoryRouter;
