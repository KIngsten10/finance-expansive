import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { BankAccount } from '../models/BankAccount.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Read-only transaction history queries. Joins source/destination account names
 * in a single aggregation pipeline to avoid N+1 lookups. Scoped to the user.
 */

function toObjectId(id) {
  return new mongoose.Types.ObjectId(id);
}

export async function listTransactions(userId, filters = {}) {
  const {
    startDate,
    endDate,
    type,
    accountId,
    minAmount, // paise
    maxAmount, // paise
    status, // optional: filter by posted/reversed
    includeReversed = true, // history shows reversed by default
    page = 1,
    limit = 20,
    sort = 'desc',
  } = filters;

  const match = { userId: toObjectId(userId) };

  const dateRange = {};
  if (startDate) {
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid startDate');
    dateRange.$gte = d;
  }
  if (endDate) {
    const d = new Date(endDate);
    if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Invalid endDate');
    dateRange.$lte = d;
  }
  if (Object.keys(dateRange).length) match.transactionDate = dateRange;

  if (type) match.type = type;
  if (status) {
    match.status = status;
  } else if (!includeReversed) {
    match.status = 'posted';
  }

  if (accountId) {
    if (!mongoose.isValidObjectId(accountId)) throw ApiError.badRequest('Invalid accountId');
    const oid = toObjectId(accountId);
    match.$or = [{ sourceAccountId: oid }, { destinationAccountId: oid }];
  }

  const amountRange = {};
  if (minAmount != null) amountRange.$gte = minAmount;
  if (maxAmount != null) amountRange.$lte = maxAmount;
  if (Object.keys(amountRange).length) match.amountPaise = amountRange;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;
  const sortDir = sort === 'asc' ? 1 : -1;

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'sourceAccountId',
        foreignField: '_id',
        as: 'sourceAccount',
      },
    },
    {
      $lookup: {
        from: BankAccount.collection.name,
        localField: 'destinationAccountId',
        foreignField: '_id',
        as: 'destinationAccount',
      },
    },
    { $unwind: { path: '$sourceAccount', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$destinationAccount', preserveNullAndEmptyArrays: true } },
  ];

  const [rows, countRow] = await Promise.all([
    Transaction.aggregate([
      ...pipeline,
      { $sort: { transactionDate: sortDir, _id: sortDir } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          type: 1,
          amountPaise: 1,
          currency: 1,
          category: 1,
          description: 1,
          transactionDate: 1,
          status: 1,
          referenceId: 1,
          referenceType: 1,
          reversalOfId: 1,
          reversedById: 1,
          sourceAccountId: 1,
          destinationAccountId: 1,
          sourceAccountName: '$sourceAccount.accountName',
          destinationAccountName: '$destinationAccount.accountName',
        },
      },
    ]),
    Transaction.aggregate([...pipeline, { $count: 'count' }]),
  ]);

  const totalCount = countRow[0]?.count ?? 0;
  return {
    rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
    },
  };
}
