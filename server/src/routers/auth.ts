import { TRPCError } from '@trpc/server';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { User } from '../../../shared/types';
import { defaultCategoriesData } from '../../../shared/categories';
import { CategoryModel } from '../models/category';
import { User as UserModel } from '../models/user';
import { publicProcedure, router } from '../trpc';

const accessSecret = () => process.env.AUTH_SECRET || 'local-development-secret';
const refreshSecret = () => process.env.REFRESH_SECRET || accessSecret();

export function verifyToken(token: string): { userId: string } {
  try {
    const claims = jwt.verify(token, accessSecret());
    if (typeof claims === 'string' || typeof claims.userId !== 'string') throw new Error();
    return { userId: claims.userId };
  } catch {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The local session has expired.' });
  }
}

function serializeUser(user: any): User {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    picture: user.picture,
    hasCompletedOnboarding: user.hasCompletedOnboarding,
  };
}

async function findUser(token: string) {
  const user = await UserModel.findById(verifyToken(token).userId);
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Local user not found.' });
  return user;
}

let bootstrap: Promise<any> | null = null;
function localUser() {
  if (!bootstrap) {
    bootstrap = (async () => {
      const identity = { googleId: 'tempo-local-user' };
      let user = await UserModel.findOne(identity);
      if (!user)
        user = await UserModel.create({
          ...identity,
          email: 'local@tempo.invalid',
          name: 'Local User',
        });
      const userId = String(user._id);
      if ((await CategoryModel.countDocuments({ userId })) === 0)
        await CategoryModel.insertMany(defaultCategoriesData(userId));
      return user;
    })().finally(() => { bootstrap = null; });
  }
  return bootstrap;
}

export const authRouter = router({
  localLogin: publicProcedure.mutation(async () => {
    // The same first-run bootstrap is shared by overlapping renderer requests.
    const user = await localUser();
    const userId = String(user._id);
    return {
      accessToken: jwt.sign({ userId }, accessSecret(), { expiresIn: '7d' }),
      refreshToken: jwt.sign({ userId, version: user.tokenVersion || 0 }, refreshSecret(), {
        expiresIn: '14d',
      }),
      user: serializeUser(user),
    };
  }),
  getUser: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => serializeUser(await findUser(input.token))),
  refreshToken: publicProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const claims = jwt.verify(input.refreshToken, refreshSecret());
        if (typeof claims === 'string' || typeof claims.userId !== 'string') throw new Error();
        const user = await UserModel.findById(claims.userId);
        if (!user || (user.tokenVersion || 0) !== claims.version) throw new Error();
        return {
          accessToken: jwt.sign({ userId: String(user._id) }, accessSecret(), { expiresIn: '7d' }),
        };
      } catch {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The local session has expired.' });
      }
    }),
  markOnboardingComplete: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const user = await findUser(input.token);
      user.hasCompletedOnboarding = true;
      await user.save();
      return { success: true };
    }),
});
