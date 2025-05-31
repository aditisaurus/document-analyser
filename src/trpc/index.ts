import { publicProcedure, router } from "./trpc";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";

export const appRouter = router({
  authCallback: publicProcedure.query(async () => {
    const { getUser } = getKindeServerSession();
    const user = getUser();

    console.log(user, "USER");

    if (!user.id || !user.email) throw new TRPCError({ code: "UNAUTHORIZED" });

    //check if user is in db
    const dbUSer = await db.user.findFirst({
      where: {
        id: user.id,
      },
    });

    if (!dbUSer) {
      await db.user.create({
        data: {
          id: user.id,
          email: user.email,
        },
      });
    }

    return { success: true };
  }),
});

export type AppRouter = typeof appRouter;
