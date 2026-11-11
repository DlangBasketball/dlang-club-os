"use client";

import * as React from "react";
import { createFamily, updateFamily } from "@/lib/actions/family";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";

export function FamilyForm({
  familyId,
  initial,
}: {
  familyId?: string;
  initial?: { name: string; address: string; phone: string };
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [address, setAddress] = React.useState(initial?.address ?? "");
  const [phone, setPhone] = React.useState(initial?.phone ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const payload = { name, address, phone };
    const res = familyId
      ? await updateFamily(familyId, payload)
      : await createFamily(payload);
    setPending(false);
    if (res && !res.ok) setError(res.error);
  }

  return (
    <Card className="max-w-xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Family name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Lopes family" />
          </div>
          <div>
            <Label htmlFor="address">Address</Label>
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rue de Lyon 24, 1203 Genève" />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+41 …" />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : familyId ? "Save changes" : "Create family"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
