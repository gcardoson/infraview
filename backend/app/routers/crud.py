"""Generic CRUD router shared by the inventory resources."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import Base, get_session

SessionDep = Annotated[Session, Depends(get_session)]


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Conflicts with existing data (duplicate or in use)"
        ) from exc


def crud_router(
    *,
    model: type[Base],
    create_schema: type[BaseModel],
    update_schema: type[BaseModel],
    read_schema: type[BaseModel],
    filters: tuple[str, ...] = (),
    order_by: str = "id",
) -> APIRouter:
    router = APIRouter()

    def get_or_404(session: Session, item_id: int) -> Any:
        item = session.get(model, item_id)
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
        return item

    @router.get("", response_model=list[read_schema])
    def list_items(
        session: SessionDep,
        site_id: int | None = Query(default=None),
        category: str | None = Query(default=None),
        limit: int = Query(default=100, ge=1, le=1000),
        offset: int = Query(default=0, ge=0),
    ) -> list[Any]:
        stmt = select(model)
        for name, value in (("site_id", site_id), ("category", category)):
            if value is not None and name in filters:
                stmt = stmt.where(getattr(model, name) == value)
        stmt = stmt.order_by(getattr(model, order_by)).limit(limit).offset(offset)
        return list(session.scalars(stmt))

    @router.post("", response_model=read_schema, status_code=status.HTTP_201_CREATED)
    def create_item(payload: create_schema, session: SessionDep) -> Any:  # type: ignore[valid-type]
        item = model(**payload.model_dump(mode="json"))
        session.add(item)
        _commit(session)
        session.refresh(item)
        return item

    @router.get("/{item_id}", response_model=read_schema)
    def get_item(item_id: int, session: SessionDep) -> Any:
        return get_or_404(session, item_id)

    @router.patch("/{item_id}", response_model=read_schema)
    def update_item(item_id: int, payload: update_schema, session: SessionDep) -> Any:  # type: ignore[valid-type]
        item = get_or_404(session, item_id)
        for key, value in payload.model_dump(mode="json", exclude_unset=True).items():
            setattr(item, key, value)
        _commit(session)
        session.refresh(item)
        return item

    @router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_item(item_id: int, session: SessionDep) -> None:
        session.delete(get_or_404(session, item_id))
        _commit(session)

    return router
