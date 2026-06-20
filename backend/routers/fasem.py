"""
FASEM-P API Routes — Profit Participation Unit Market
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from routers.auth import get_current_user
from fasem import (
    register_company, list_companies, get_company,
    issue_ppus, trade_ppus, get_company_ppus, get_owner_ppus,
    declare_profit, distribute_profit, get_profit_history, get_profit_distributions,
    deploy_capital, get_compliance_report, get_company_deployments,
)

router = APIRouter(prefix="/api/fasem", tags=["fasem"])


class RegisterCompanyReq(BaseModel):
    token: str
    name: str
    description: str = ""
    sector: str = ""
    founder_user_id: int | None = None  # defaults to authenticated user
    float_ratio: float = Field(default=0.5, ge=0.0, le=1.0)
    ppu_face_value: float = Field(default=1.0, gt=0.0)


class IssuePPUReq(BaseModel):
    token: str
    company_id: int
    owner_id: int
    units: float = Field(..., gt=0)
    price_per_unit: float = Field(..., gt=0)


class TradePPUReq(BaseModel):
    token: str
    ppu_id: int
    buyer_id: int
    seller_id: int
    units: float = Field(..., gt=0)
    price_per_unit: float = Field(..., gt=0)


class DeclareProfitReq(BaseModel):
    token: str
    company_id: int
    period_label: str
    total_profit: float = Field(..., gt=0)


class DeployCapitalReq(BaseModel):
    token: str
    company_id: int
    amount: float = Field(..., gt=0)
    category: str = Field(..., pattern=r"^(expansion|equipment|facilities|inventory|wages|logistics)$")
    description: str = ""
    receipt_reference: str = ""


# ==================== COMPANIES ====================

@router.post("/companies/register")
def api_register_company(req: RegisterCompanyReq):
    user = get_current_user(req.token)
    founder_id = req.founder_user_id if req.founder_user_id is not None else user["user_id"]
    try:
        cid = register_company(req.name, req.description, req.sector,
                                founder_id, req.float_ratio, req.ppu_face_value)
        return {"company_id": cid, "message": "Company registered"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/companies")
def api_list_companies(token: str):
    get_current_user(token)
    return list_companies()


@router.get("/companies/{company_id}")
def api_get_company(company_id: int, token: str):
    get_current_user(token)
    company = get_company(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


# ==================== PPUS ====================

@router.post("/ppus/issue")
def api_issue_ppus(req: IssuePPUReq):
    get_current_user(req.token)
    try:
        ppu_id = issue_ppus(req.company_id, req.owner_id, req.units, req.price_per_unit)
        return {"ppu_id": ppu_id, "units": req.units, "message": "PPUs issued"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/ppus/trade")
def api_trade_ppus(req: TradePPUReq):
    get_current_user(req.token)
    try:
        result = trade_ppus(req.ppu_id, req.buyer_id, req.seller_id, req.units, req.price_per_unit)
        return {**result, "message": "PPU trade executed"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ppus/company/{company_id}")
def api_get_company_ppus(company_id: int, token: str):
    get_current_user(token)
    return get_company_ppus(company_id)


@router.get("/ppus/owner/{owner_id}")
def api_get_owner_ppus(owner_id: int, token: str):
    get_current_user(token)
    return get_owner_ppus(owner_id)


# ==================== PROFIT ====================

@router.post("/profit/declare")
def api_declare_profit(req: DeclareProfitReq):
    get_current_user(req.token)
    try:
        decl_id = declare_profit(req.company_id, req.period_label, req.total_profit)
        return {"declaration_id": decl_id, "message": "Profit declared"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/profit/distribute/{declaration_id}")
def api_distribute_profit(declaration_id: int, token: str):
    get_current_user(token)
    try:
        distributions = distribute_profit(declaration_id)
        return {"distributions": distributions, "count": len(distributions), "message": "Profit distributed"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/profit/history/{company_id}")
def api_get_profit_history(company_id: int, token: str):
    get_current_user(token)
    return get_profit_history(company_id)


@router.get("/profit/distributions/{declaration_id}")
def api_get_profit_distributions(declaration_id: int, token: str):
    get_current_user(token)
    return get_profit_distributions(declaration_id)


# ==================== CAPITAL ====================

@router.post("/capital/deploy")
def api_deploy_capital(req: DeployCapitalReq):
    get_current_user(req.token)
    try:
        dep_id = deploy_capital(req.company_id, req.amount, req.category, req.description, req.receipt_reference)
        return {"deployment_id": dep_id, "message": "Capital deployment recorded"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/capital/compliance/{company_id}")
def api_get_compliance(company_id: int, token: str):
    get_current_user(token)
    try:
        return get_compliance_report(company_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/capital/deployments/{company_id}")
def api_get_company_deployments(company_id: int, token: str):
    get_current_user(token)
    return get_company_deployments(company_id)