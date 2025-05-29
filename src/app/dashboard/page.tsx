import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import React from "react";
import { redirect } from "next/navigation";

const Page = () => {
  const { getUser } = getKindeServerSession();

  const user = getUser();

  if (!user || !user.id) redirect("/auth-callback?origin=dashboard");

  return <div></div>;
};

export default Page;
