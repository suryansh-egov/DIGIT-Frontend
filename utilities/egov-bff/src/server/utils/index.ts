import { NextFunction, Request, Response } from "express";
import { httpRequest } from "../utils/request";
import config from "../config/index";
import { v4 as uuidv4, validate } from 'uuid';
import { produceModifiedMessages } from '../Kafka/Listener'
import { createAndUploadFile, createExcelSheet, getAllFacilities, getBoundaryCodesHandler, getBoundarySheetData, getCampaignNumber, getResouceNumber, getSchema, getSheetData, searchMDMS } from "../api/index";
import * as XLSX from 'xlsx';
import FormData from 'form-data';
import { Pagination } from "../utils/Pagination";
import { Pool } from 'pg';
import { getCount } from '../api/index'
import { logger } from "./logger";
import { processValidationWithSchema } from "./validator";
import dataManageController from "../controllers/dataManage/dataManage.controller";
import createAndSearch from "../config/createAndSearch";
const NodeCache = require("node-cache");
const _ = require('lodash');

const updateGeneratedResourceTopic = config.KAFKA_UPDATE_GENERATED_RESOURCE_DETAILS_TOPIC;
const createGeneratedResourceTopic = config.KAFKA_CREATE_GENERATED_RESOURCE_DETAILS_TOPIC;

/*
  stdTTL: (default: 0) the standard ttl as number in seconds for every generated
   cache element. 0 = unlimited

  checkperiod: (default: 600) The period in seconds, as a number, used for the automatic
   delete check interval. 0 = no periodic check.

   30 mins caching
*/

const appCache = new NodeCache({ stdTTL: 1800000, checkperiod: 300 });

/* 
Send The Error Response back to client with proper response code 
*/
const throwError = (
  message = "Internal Server Error",
  code = "INTERNAL_SERVER_ERROR",
  status = 500
) => {
  let error = new Error(message);
  //   error.status = status;
  //   error.code = code;
  logger.error("Error : " + error);

  throw error;
};

/* 
Error Object
*/
const getErrorResponse = (
  code = "INTERNAL_SERVER_ERROR",
  message = "Some Error Occured!!"
) => ({
  ResponseInfo: null,
  Errors: [
    {
      code: code,
      message: message,
      description: null,
      params: null,
    },
  ],
});

/* 
Send The Response back to client with proper response code and response info
*/
const sendResponse = (
  response: Response,
  responseBody: any,
  req: Request,
  code: number = 200
) => {
  /* if (code != 304) {
    appCache.set(req.headers.cachekey, { ...responseBody });
  } else {
    logger.info("CACHED RESPONSE FOR :: " + req.headers.cachekey);
  }
  */
  response.status(code).send({
    ...getResponseInfo(code),
    ...responseBody,
  });
};

/* 
Sets the cahce response
*/
const cacheResponse = (res: Response, key: string) => {
  if (key != null) {
    appCache.set(key, { ...res });
    logger.info("CACHED RESPONSE FOR :: " + key);
  }
};

/* 
gets the cahce response
*/
const getCachedResponse = (key: string) => {
  if (key != null) {
    const data = appCache.get(key);
    if (data) {
      logger.info("CACHE STATUS :: " + JSON.stringify(appCache.getStats()));
      logger.info("RETURNS THE CACHED RESPONSE FOR :: " + key);
      return data;
    }
  }
  return null;
};

/* 
Response Object
*/
const getResponseInfo = (code: Number) => ({
  ResponseInfo: {
    apiId: "egov-bff",
    ver: "0.0.1",
    ts: new Date().getTime(),
    status: "successful",
    desc: code == 304 ? "cached-response" : "new-response",
  },
});

/* 
Fallback Middleware function for returning 404 error for undefined paths
*/
const invalidPathHandler = (
  request: any,
  response: any,
  next: NextFunction
) => {
  response.status(404);
  response.send(getErrorResponse("INVALID_PATH", "invalid path"));
};

/*
Error handling Middleware function for logging the error message
*/
const errorLogger = (
  error: Error,
  request: any,
  response: any,
  next: NextFunction
) => {
  logger.error(error.stack);
  logger.error(`error ${error.message}`);
  next(error); // calling next middleware
};

/*
Error handling Middleware function reads the error message and sends back a response in JSON format
*/
const errorResponder = (
  error: any,
  request: any,
  response: Response,
  next: any = null
) => {
  response.header("Content-Type", "application/json");
  const status = 500;
  response
    .status(status)
    .send(getErrorResponse("INTERNAL_SERVER_ERROR", error?.message));
};

async function getCampaignDetails(requestBody: any): Promise<any> {
  const hcmConfig: any = requestBody?.HCMConfig;
  const userInfo: any = requestBody?.RequestInfo?.userInfo;
  const additionalDetails = { selectedRows: hcmConfig?.selectedRows };
  const campaignNumber = await getCampaignNumber(requestBody, config.values.idgen.format, config.values.idgen.idName);
  if (typeof campaignNumber !== 'string') {
    return "INVALID_CAMPAIGN_NUMBER"
  }
  logger.info("Campaign number : " + campaignNumber)
  // Extract details from HCMConfig 
  const campaignDetails = {
    id: uuidv4(),
    tenantId: hcmConfig.tenantId,
    fileStoreId: hcmConfig.fileStoreId,
    campaignType: hcmConfig.campaignType,
    status: "Not-Started",
    projectTypeId: hcmConfig.projectTypeId,
    campaignName: hcmConfig.campaignName,
    campaignNumber: campaignNumber,
    auditDetails: {
      createdBy: userInfo?.uuid,
      lastModifiedBy: userInfo?.uuid,
      createdTime: new Date().getTime(),
      lastModifiedTime: new Date().getTime(),
    },
    additionalDetails: additionalDetails ? JSON.stringify(additionalDetails) : ""
  };

  return campaignDetails;
}

function generateSortingAndPaginationClauses(pagination: Pagination): string {
  let clauses = '';

  if (pagination && pagination.sortBy && pagination.sortOrder) {
    clauses += ` ORDER BY ${pagination.sortBy} ${pagination.sortOrder}`;
  }

  if (pagination && pagination.limit !== undefined) {
    clauses += ` LIMIT ${pagination.limit}`;
  }

  if (pagination && pagination.offset !== undefined) {
    clauses += ` OFFSET ${pagination.offset}`;
  }

  return clauses;
}
async function generateXlsxFromJson(request: any, response: any, simplifiedData: any) {
  try {
    const ws = XLSX.utils.json_to_sheet(simplifiedData);

    // Create a new workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet 1');
    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const formData = new FormData();
    formData.append('file', buffer, 'filename.xlsx');
    formData.append('tenantId', request?.body?.RequestInfo?.userInfo?.tenantId);
    formData.append('module', 'pgr');

    logger.info("File uploading url : " + config.host.filestore + config.paths.filestore);
    var fileCreationResult = await httpRequest(config.host.filestore + config.paths.filestore, formData, undefined, undefined, undefined,
      {
        'Content-Type': 'multipart/form-data',
        'auth-token': request?.body?.RequestInfo?.authToken
      }
    );
    const responseData = fileCreationResult?.files;
    logger.info("Response data after File Creation : " + JSON.stringify(responseData));
    return responseData;
  } catch (e: any) {
    const errorMessage = "Error occurred while fetching the file store ID: " + e.message;
    logger.error(errorMessage)
    return errorResponder({ message: errorMessage + "    Check Logs" }, request, response);
  }
}

async function generateAuditDetails(request: any) {

  const createdBy = request?.body?.RequestInfo?.userInfo?.uuid;
  const lastModifiedBy = request?.body?.RequestInfo?.userInfo?.uuid;


  const auditDetails = {
    createdBy: createdBy,
    lastModifiedBy: lastModifiedBy,
    createdTime: Date.now(),
    lastModifiedTime: Date.now()
  }

  return auditDetails;
}

async function generateResourceMessage(requestBody: any, status: string) {

  const resourceMessage = {
    id: uuidv4(),
    status: status,
    tenantId: requestBody?.RequestInfo?.userInfo?.tenantId,
    processReferenceNumber: await getResouceNumber(requestBody?.RequestInfo, "RD-[cy:yyyy-MM-dd]-[SEQ_EG_RD_ID]", "resource.number"),
    fileStoreId: requestBody?.ResourceDetails?.fileStoreId,
    statusFileStoreId: null,
    type: requestBody?.ResourceDetails?.type,
    auditDetails: {
      createdBy: requestBody?.RequestInfo?.userInfo?.uuid,
      lastModifiedBy: requestBody?.RequestInfo?.userInfo?.uuid,
      createdTime: Date.now(),
      lastModifiedTime: Date.now()
    },
    additionalDetails: {}
  }
  return resourceMessage;
}

async function generateActivityMessage(requestBody: any, requestPayload: any, responsePayload: any, type: any, url: any, status: any) {
  const activityMessage = {
    id: uuidv4(),
    status: status,
    retryCount: 0,
    type: type,
    url: url,
    requestPayload: requestPayload,
    responsePayload: responsePayload,
    auditDetails: {
      createdBy: requestBody?.RequestInfo?.userInfo?.uuid,
      lastModifiedBy: requestBody?.RequestInfo?.userInfo?.uuid,
      createdTime: Date.now(),
      lastModifiedTime: Date.now()
    },
    additionalDetails: {},
    resourceDetailsId: null
  }
  return activityMessage;
}

function modifyAuditdetailsAndCases(responseData: any) {
  responseData.forEach((item: any) => {
    item.auditDetails = {
      lastModifiedTime: item.lastmodifiedtime,
      createdTime: item.createdtime,
      lastModifiedBy: item.lastmodifiedby,
      createdBy: item.createdby
    }
    item.tenantId = item.tenantid;
    item.additionalDetails = item.additionaldetails;
    item.fileStoreid = item.filestoreid;
    delete item.additionaldetails;
    delete item.lastmodifiedtime;
    delete item.createdtime;
    delete item.lastmodifiedby;
    delete item.createdby;
    delete item.filestoreid;
    delete item.tenantid;
  })
}

async function getResponseFromDb(request: any, response: any) {
  const pool = new Pool({
    user: config.DB_USER,
    host: config.DB_HOST,
    database: config.DB_NAME,
    password: config.DB_PASSWORD,
    port: parseInt(config.DB_PORT)
  });

  try {
    const { type } = request.query;

    let queryString = "SELECT * FROM eg_generated_resource_details WHERE type = $1 AND status = $2";
    const status = 'Completed';
    const queryResult = await pool.query(queryString, [type, status]);
    const responseData = queryResult.rows;
    modifyAuditdetailsAndCases(responseData);
    return responseData;
  } catch (error) {
    logger.error('Error fetching data from the database:', error);
    throw error;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      logger.error('Error closing the database connection pool:', error);
    }
  }
}
async function getModifiedResponse(responseData: any) {
  return responseData.map((item: any) => {
    return {
      ...item,
      count: parseInt(item.count),
      auditDetails: {
        ...item.auditDetails,
        lastModifiedTime: parseInt(item.auditDetails.lastModifiedTime),
        createdTime: parseInt(item.auditDetails.createdTime)
      }
    };
  });
}

async function getNewEntryResponse(modifiedResponse: any, request: any) {
  const { type } = request.query;
  const newEntry = {
    id: uuidv4(),
    fileStoreid: null,
    type: type,
    status: "In Progress",
    tenantId: request?.query?.tenantId,
    auditDetails: {
      lastModifiedTime: Date.now(),
      createdTime: Date.now(),
      createdBy: request?.body?.RequestInfo?.userInfo.uuid,
      lastModifiedBy: request?.body?.RequestInfo?.userInfo.uuid,
    },
    additionalDetails: {}
  };
  return [newEntry];
}
async function getOldEntryResponse(modifiedResponse: any[], request: any) {
  return modifiedResponse.map((item: any) => {
    const newItem = { ...item };
    newItem.status = "expired";
    newItem.auditDetails.lastModifiedTime = Date.now();
    newItem.auditDetails.lastModifiedBy = request?.body?.RequestInfo?.userInfo?.uuid;
    return newItem;
  });
}
async function getFinalUpdatedResponse(result: any, responseData: any, request: any) {
  return responseData.map((item: any) => {
    return {
      ...item,
      tenantId: request?.query?.tenantId,
      count: parseInt(request?.body?.generatedResourceCount ? request?.body?.generatedResourceCount : null),
      auditDetails: {
        ...item.auditDetails,
        lastModifiedTime: Date.now(),
        createdTime: Date.now(),
        lastModifiedBy: request?.body?.RequestInfo?.userInfo?.uuid
      },
      fileStoreid: result?.[0]?.fileStoreId,
      status: "Completed",
    };
  });
}

async function callSearchApi(request: any, response: any) {
  try {
    let result: any;
    const { type } = request.query;
    result = await searchMDMS([type], config.SEARCH_TEMPLATE, request.body.RequestInfo, response);
    const filter = request?.body?.Filters;
    const requestBody = { "RequestInfo": request?.body?.RequestInfo, filter };
    const responseData = result?.mdms?.[0]?.data;
    if (!responseData || responseData.length === 0) {
      return errorResponder({ message: "Invalid ApiResource Type. Check Logs" }, request, response);
    }
    const host = responseData?.host;
    const url = responseData?.searchConfig?.url;
    var queryParams: any = {};
    for (const searchItem of responseData?.searchConfig?.searchBody) {
      if (searchItem.isInParams) {
        queryParams[searchItem.path] = searchItem.value;
      }
      else if (searchItem.isInBody) {
        _.set(requestBody, `${searchItem.path}`, searchItem.value);
      }
    }
    const countknown = responseData?.searchConfig?.isCountGiven === true;
    let responseDatas: any[] = [];
    const searchPath = responseData?.searchConfig?.keyName;
    let fetchedData: any;
    let responseObject: any;

    if (countknown) {
      const count = await getCount(responseData, request, response);
      let noOfTimesToFetchApi = Math.ceil(count / queryParams.limit);
      for (let i = 0; i < noOfTimesToFetchApi; i++) {
        responseObject = await httpRequest(host + url, requestBody, queryParams, undefined, undefined, undefined);
        fetchedData = _.get(responseObject, searchPath);
        fetchedData.forEach((item: any) => {
          responseDatas.push(item);
        });
        queryParams.offset = (parseInt(queryParams.offset) + parseInt(queryParams.limit)).toString();
      }
    }

    else {
      while (true) {
        responseObject = await httpRequest(host + url, requestBody, queryParams, undefined, undefined, undefined);
        fetchedData = _.get(responseObject, searchPath);
        fetchedData.forEach((item: any) => {
          responseDatas.push(item);
        });
        queryParams.offset = (parseInt(queryParams.offset) + parseInt(queryParams.limit)).toString();
        if (fetchedData.length < parseInt(queryParams.limit)) {
          break;
        }
      }
    }
    return responseDatas;
  }
  catch (e: any) {
    logger.error(String(e))
    return errorResponder({ message: String(e) + "    Check Logs" }, request, response);
  }
}

async function fullProcessFlowForNewEntry(newEntryResponse: any, request: any, response: any) {
  try {
    const type = request?.query?.type;
    const generatedResource: any = { generatedResource: newEntryResponse }
    produceModifiedMessages(generatedResource, createGeneratedResourceTopic);
    if (type === 'boundary') {
      const BoundaryDetails = {
        hierarchyType: "NITISH",
        tenantId: "pg"
      };
      request.body.BoundaryDetails = BoundaryDetails;
      const dataManagerController = new dataManageController();
      const result = await dataManagerController.getBoundaryData(request, response);
      const finalResponse = await getFinalUpdatedResponse(result, newEntryResponse, request);
      const generatedResourceNew: any = { generatedResource: finalResponse }
      produceModifiedMessages(generatedResourceNew, updateGeneratedResourceTopic);
    }
    else if (type == "facilityWithBoundary") {
      await processGenerateRequest(request);
      const finalResponse = await getFinalUpdatedResponse(request?.body?.fileDetails, newEntryResponse, request);
      const generatedResourceNew: any = { generatedResource: finalResponse }
      produceModifiedMessages(generatedResourceNew, updateGeneratedResourceTopic);
      request.body.generatedResource = finalResponse;
    }
    else {
      const responseDatas = await callSearchApi(request, response);
      const modifiedDatas = await modifyData(request, response, responseDatas);
      const result = await generateXlsxFromJson(request, response, modifiedDatas);
      const finalResponse = await getFinalUpdatedResponse(result, newEntryResponse, request);
      const generatedResourceNew: any = { generatedResource: finalResponse }
      produceModifiedMessages(generatedResourceNew, updateGeneratedResourceTopic);
    }
  } catch (error) {
    throw error;
  }
}
async function modifyData(request: any, response: any, responseDatas: any) {
  try {
    let result: any;
    const hostHcmBff = config.host.hcmBff.endsWith('/') ? config.host.hcmBff.slice(0, -1) : config.host.hcmBff;
    const { type } = request.query;
    result = await searchMDMS([type], config.SEARCH_TEMPLATE, request.body.RequestInfo, response);
    const modifiedParsingTemplate = result?.mdms?.[0]?.data?.modificationParsingTemplateName;
    if (!request.body.HCMConfig) {
      request.body.HCMConfig = {};
    }
    const batchSize = 50;
    const totalBatches = Math.ceil(responseDatas.length / batchSize);
    const allUpdatedData = [];

    for (let i = 0; i < totalBatches; i++) {
      const batchData = responseDatas.slice(i * batchSize, (i + 1) * batchSize);
      const batchRequestBody = { ...request.body };
      batchRequestBody.HCMConfig.parsingTemplate = modifiedParsingTemplate;
      batchRequestBody.HCMConfig.data = batchData;

      try {
        const processResult = await httpRequest(`${hostHcmBff}${config.app.contextPath}/bulk/_process`, batchRequestBody, undefined, undefined, undefined, undefined);
        if (processResult.Error) {
          throw new Error(processResult.Error);
        }
        allUpdatedData.push(...processResult.updatedDatas);
      } catch (error: any) {
        throw error;
      }
    }
    return allUpdatedData;
  }
  catch (e: any) {
    throw e;
  }
}


function isEpoch(value: any): boolean {
  // Check if the value is a number
  if (typeof value !== 'number') {
    return false;
  }

  // Create a new Date object from the provided value
  const date = new Date(value);

  // Check if the date is valid and the value matches the provided epoch time
  return !isNaN(date.getTime()) && date.getTime() === value;
}

function dateToEpoch(dateString: string): number | null {
  // Parse the date string
  const parsedDate = Date.parse(dateString);

  // Check if the parsing was successful
  if (!isNaN(parsedDate)) {
    // Convert milliseconds since epoch to seconds since epoch
    return parsedDate / 1000;
  } else {
    return null; // Parsing failed, return null
  }
}

async function matchWithCreatedDetails(request: any, response: any, ResponseDetails: any, creationTime: any, rowsToMatch: number) {
  const waitTime = config.waitTime;
  logger.info("Waiting for " + waitTime + "ms before Checking Persistence");
  await new Promise(resolve => setTimeout(resolve, parseInt(waitTime)));
  var requestWithParams = { ...request }
  requestWithParams.query = { ...requestWithParams.query, type: request?.body?.ResourceDetails?.type, forceUpdate: true }
  const rows: any = await callSearchApi(requestWithParams, response);
  var count = 0;
  var createdDetailsPresent = false;
  logger.info("Checking Persistence with createdBy for  " + request?.body?.RequestInfo?.userInfo?.uuid + " and createdTime " + creationTime);
  rows.forEach((item: any) => {
    var createdBy = item?.auditDetails?.createdBy || item?.createdBy;
    var createdTime = item?.auditDetails?.createdTime || item?.createdTime || item?.auditDetails?.createdDate || item?.createdDate;
    if (createdBy && createdTime) {
      var userMatch = false;
      var timeMatch = false;
      if (validate(createdBy)) {
        userMatch = createdBy == request?.body?.RequestInfo?.userInfo?.uuid
      }
      else {
        userMatch = createdBy == request?.body?.RequestInfo?.userInfo?.id
      }
      if (isEpoch(createdTime)) {
        timeMatch = createdTime >= creationTime
      }
      else {
        createdTime = dateToEpoch(createdBy);
        if (createdTime) {
          timeMatch = createdTime >= creationTime
        }
      }
      if (userMatch && timeMatch) {
        count++;
      }
    }
    if (createdBy && createdTime) {
      createdDetailsPresent = true;
    }
  })
  logger.info("Got " + count + " rows with recent persistence");
  if (count >= rowsToMatch) {
    return ResponseDetails;
  }
  else if (createdDetailsPresent) {
    ResponseDetails.status = "PERSISTING_ERROR";
    return ResponseDetails;
  }
  logger.info("No createdBy and createdTime found in Rows.");
  ResponseDetails.status = "PERSISTENCE_CHECK_REQUIRED";
  return ResponseDetails;
}

function getCreationDetails(APIResource: any, sheetName: any) {
  // Assuming APIResource has the necessary structure to extract creation details
  // Replace the following lines with the actual logic to extract creation details
  const host = APIResource?.mdms?.[0]?.data?.host;
  const url = APIResource?.mdms?.[0]?.data?.creationConfig?.url;
  const keyName = APIResource?.mdms?.[0]?.data?.creationConfig?.keyName;
  const isBulkCreate = APIResource?.mdms?.[0]?.data?.creationConfig?.isBulkCreate;
  const creationLimit = APIResource?.mdms?.[0]?.data?.creationConfig?.limit;
  const responsePathToCheck = APIResource?.mdms?.[0]?.data?.creationConfig?.responsePathToCheck;
  const checkOnlyExistence = APIResource?.mdms?.[0]?.data?.creationConfig?.checkOnlyExistence;
  const matchDataLength = APIResource?.mdms?.[0]?.data?.creationConfig?.matchDataLength;
  const responseToMatch = APIResource?.mdms?.[0]?.data?.creationConfig?.responseToMatch;
  const createBody = APIResource?.mdms?.[0]?.data?.creationConfig?.createBody;

  return {
    host,
    url,
    keyName,
    isBulkCreate,
    creationLimit,
    responsePathToCheck,
    checkOnlyExistence,
    matchDataLength,
    responseToMatch,
    createBody,
    sheetName
  };
}

function addRowDetails(processResultUpdatedDatas: any[], updatedDatas: any[]): void {
  if (!processResultUpdatedDatas) return;
  processResultUpdatedDatas.forEach((item, index) => {
    if (index < updatedDatas.length) {
      item['#row!number#'] = updatedDatas[index]['#row!number#'];
    }
  });
}


async function getSchemaAndProcessResult(request: any, parsingTemplate: any, updatedDatas: any, APIResource: any) {
  const hostHcmBff = config.host.hcmBff.endsWith('/') ? config.host.hcmBff.slice(0, -1) : config.host.hcmBff;
  let processResult;
  request.body.HCMConfig = {};
  request.body.HCMConfig['parsingTemplate'] = parsingTemplate;
  request.body.HCMConfig['data'] = updatedDatas;

  // Process data
  processResult = await httpRequest(`${hostHcmBff}${config.app.contextPath}${'/bulk'}/_process`, request.body, undefined, undefined, undefined, undefined);
  addRowDetails(processResult?.updatedDatas, updatedDatas);
  if (processResult.Error) {
    logger.error(processResult.Error);
    throw new Error(processResult.Error);
  }

  const healthMaster = APIResource?.mdms?.[0]?.data?.masterDetails?.masterName + "." + APIResource?.mdms?.[0]?.data?.masterDetails?.moduleName;

  // Get schema definition
  const schemaDef = await getSchema(healthMaster, request?.body?.RequestInfo);

  return { processResult, schemaDef };
}

async function processValidationResultsAndSendResponse(sheetName: any, processResult: any, schemaDef: any, APIResource: any, response: any, request: any) {
  const validationErrors: any[] = [];
  const validatedData: any[] = [];
  processValidationWithSchema(processResult, validationErrors, validatedData, schemaDef);

  // Include error messages from MDMS service
  const mdmsErrors = processResult?.mdmsErrors || [];

  // Send response
  if (validationErrors.length > 0 || mdmsErrors.length > 0) {
    if (validationErrors?.[0] == "NO_VALIDATION_SCHEMA_FOUND") {
      const creationDetails = getCreationDetails(APIResource, sheetName);
      return sendResponse(response, {
        "validationResult": "NO_VALIDATION_SCHEMA_FOUND",
        "data": validatedData,
        creationDetails
      }, request);
    }
    const errors = [...validationErrors, ...mdmsErrors];
    return sendResponse(response, { "validationResult": "INVALID_DATA", "errors": errors }, request);
  } else {
    const creationDetails = getCreationDetails(APIResource, sheetName);
    return sendResponse(response, {
      "validationResult": "VALID_DATA",
      "data": validatedData,
      creationDetails
    }, request);
  }
}


function sortCampaignDetails(campaignDetails: any) {
  campaignDetails.sort((a: any, b: any) => {
    // If a is a child of b, a should come after b
    if (a.parentBoundaryCode === b.boundaryCode) return 1;
    // If b is a child of a, a should come before b
    if (a.boundaryCode === b.parentBoundaryCode) return -1;
    // Otherwise, maintain the order
    return 0;
  });
  return campaignDetails;
}
// Function to correct the totals and target values of parents
function correctParentValues(campaignDetails: any) {
  // Create a map to store parent-child relationships and their totals/targets
  const parentMap: any = {};
  campaignDetails.forEach((detail: any) => {
    if (!detail.parentBoundaryCode) return; // Skip if it's not a child
    if (!parentMap[detail.parentBoundaryCode]) {
      parentMap[detail.parentBoundaryCode] = { total: 0, target: 0 };
    }
    parentMap[detail.parentBoundaryCode].total += detail.targets[0].total;
    parentMap[detail.parentBoundaryCode].target += detail.targets[0].target;
  });

  // Update parent values with the calculated totals and targets
  campaignDetails.forEach((detail: any) => {
    if (!detail.parentBoundaryCode) return; // Skip if it's not a child
    const parent = parentMap[detail.parentBoundaryCode];
    const target = detail.targets[0];
    target.total = parent.total;
    target.target = parent.target;
  });

  return campaignDetails;
}

async function createFacilitySheet(allFacilities: any[]) {
  const headers = ["Facility Code", "Facility Name", "Facility Type", "Facility Status", "Facility Capacity", "Boundary Code"]
  const facilities = allFacilities.map((facility: any) => {
    return [
      facility?.id,
      facility?.name,
      facility?.usage,
      facility?.isPermanent ? "Perm" : "Temp",
      facility?.storageCapacity,
      ""
    ]
  })
  logger.info("facilities : " + JSON.stringify(facilities));
  const facilitySheetData: any = await createExcelSheet(facilities, headers, "List of Available Facilities");
  return facilitySheetData;
}

async function createFacilityAndBoundaryFile(facilitySheetData: any, boundarySheetData: any, request: any) {
  const workbook = XLSX.utils.book_new();
  // Add facility sheet to the workbook
  XLSX.utils.book_append_sheet(workbook, facilitySheetData.ws, 'List of Available Facilities');
  // Add boundary sheet to the workbook
  XLSX.utils.book_append_sheet(workbook, boundarySheetData.ws, 'List of Campaign Boundaries');
  const fileDetails = await createAndUploadFile(workbook, request)
  request.body.fileDetails = fileDetails;
}


async function generateFacilityAndBoundarySheet(tenantId: string, request: any) {
  // Get facility and boundary data
  const allFacilities = await getAllFacilities(tenantId, request.body);
  request.body.generatedResourceCount = allFacilities.length;
  const facilitySheetData: any = await createFacilitySheet(allFacilities);
  request.body.Filters = { tenantId: tenantId, hierarchyType: request?.query?.hierarchyType, includeChildren: true }
  const boundarySheetData: any = await getBoundarySheetData(request);
  await createFacilityAndBoundaryFile(facilitySheetData, boundarySheetData, request);
}
async function processGenerateRequest(request: any) {
  const { type, tenantId } = request.query
  if (type == "facilityWithBoundary") {
    await generateFacilityAndBoundarySheet(String(tenantId), request);
  }
}

async function updateAndPersistGenerateRequest(newEntryResponse: any, oldEntryResponse: any, responseData: any, request: any, response: any) {
  const { forceUpdate } = request.query;
  const forceUpdateBool: boolean = forceUpdate === 'true';
  let generatedResource: any;
  if (forceUpdateBool && responseData.length > 0) {
    generatedResource = { generatedResource: oldEntryResponse };
    produceModifiedMessages(generatedResource, updateGeneratedResourceTopic);
    request.body.generatedResource = oldEntryResponse;
  }
  if (responseData.length === 0 || forceUpdateBool) {
    await fullProcessFlowForNewEntry(newEntryResponse, request, response);
  }
  else {
    request.body.generatedResource = responseData
  }
}

async function processGenerate(request: any, response: any) {
  const responseData = await getResponseFromDb(request, response);
  const modifiedResponse = await getModifiedResponse(responseData);
  const newEntryResponse = await getNewEntryResponse(modifiedResponse, request);
  const oldEntryResponse = await getOldEntryResponse(modifiedResponse, request);
  await updateAndPersistGenerateRequest(newEntryResponse, oldEntryResponse, responseData, request, response);
}

function convertToFacilityCreateData(facilityData: any[], tenantId: string) {
  const facilityCreateData = facilityData.map(facility => ({
    "tenantId": tenantId,
    "isPermanent": facility['Facility Status'] === 'Perm',
    "name": facility['Facility Name'],
    "usage": facility['Facility Type'],
    "storageCapacity": facility['Facility Capacity']
  }));
  logger.info("facilityCreateData : " + JSON.stringify(facilityCreateData));
  return facilityCreateData;
}

function convertToFacilityExsistingData(facilityData: any[]) {
  const facilityExsistingData = facilityData.map(facility => ({
    "id": facility['Facility Code'],
    "isPermanent": facility['Facility Status'] === 'Perm',
    "name": facility['Facility Name'],
    "usage": facility['Facility Type'],
    "storageCapacity": facility['Facility Capacity'],
    originalIndex: facility.originalIndex
  }));
  logger.info("facilityExsistingData : " + JSON.stringify(facilityExsistingData));
  return facilityExsistingData;
}

async function enrichResourceDetails(request: any) {
  request.body.ResourceDetails.id = uuidv4();
  if (request?.body?.ResourceDetails?.action == "create") {
    request.body.ResourceDetails.status = "data-accepted"
  }
  else {
    request.body.ResourceDetails.status = "data-validated"
  }
  request.body.ResourceDetails.auditDetails = {
    createdBy: request?.body?.RequestInfo?.userInfo?.uuid,
    createdTime: Date.now(),
    lastModifiedBy: request?.body?.RequestInfo?.userInfo?.uuid,
    lastModifiedTime: Date.now()
  }
  // delete request.body.ResourceDetails.dataToCreate
}

function getFacilityIds(data: any) {
  return data.map((obj: any) => obj["id"])
}

function matchFacilityData(data: any, searchedFacilities: any) {
  for (const dataFacility of data) {
    const searchedFacility = searchedFacilities.find((facility: any) => facility.id === dataFacility.id);

    if (!searchedFacility) {
      throw new Error(`Facility with ID "${dataFacility.id}" not found in searched facilities.`);
    }
    if (config?.values?.matchFacilityData) {
      const keys = Object.keys(dataFacility);
      for (const key of keys) {
        if (searchedFacility.hasOwnProperty(key) && searchedFacility[key] !== dataFacility[key]) {
          throw new Error(`Value mismatch for key "${key}" at index ${dataFacility.originalIndex}. Expected: "${dataFacility[key]}", Found: "${searchedFacility[key]}"`);
        }
      }
    }
  }
}

function matchData(request: any, datas: any, searchedDatas: any, createAndSearchConfig: any) {
  const uid = createAndSearchConfig.uniqueIdentifier;
  const errors = []
  for (const data of datas) {
    const searchData = searchedDatas.find((searchedData: any) => searchedData[uid] == data[uid]);

    if (!searchData) {
      errors.push({ status: "INVALID", rowNumber: data["!row#number!"], errorDetails: `Data with ${uid} ${data[uid]} not found in searched data.` })
    }
    else if (createAndSearchConfig?.matchEachKey) {
      const keys = Object.keys(data);
      for (const key of keys) {
        var errorString = "";
        var errorFound = false;
        if (searchData.hasOwnProperty(key) && searchData[key] !== data[key] && key != "!row#number!") {
          errorString += `Value mismatch for key "${key}" at index ${data["!row#number!"] - 1}. Expected: "${data[key]}", Found: "${searchData[key]}"`
          errorFound = true;
        }
        if (errorFound) {
          errors.push({ status: "MISMATCHING", rowNumber: data["!row#number!"], errorDetails: errorString })
        }
        else {
          errors.push({ status: "VALID", rowNumber: data["!row#number!"], errorDetails: "" })
        }
      }
    }
    else {
      errors.push({ status: "VALID", rowNumber: data["!row#number!"], errorDetails: "" })
    }
  }
  request.body.sheetErrorDetails = request?.body?.sheetErrorDetails ? [...request?.body?.sheetErrorDetails, ...errors] : errors;
}

async function autoGenerateBoundaryCodes(tenantId: string, fileStoreId: string) {
  const fileResponse = await httpRequest(config.host.filestore + config.paths.filestore + "/url", {}, { tenantId: tenantId, fileStoreIds: fileStoreId }, "get");
  if (!fileResponse?.fileStoreIds?.[0]?.url) {
    throw new Error("Invalid file")
  }
  const boundaryData = await getSheetData(fileResponse?.fileStoreIds?.[0]?.url, "Sheet1")
  const outputData: string[][] = [];

  for (const obj of boundaryData) {
    const row: string[] = [];
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        row.push(obj[key]);
      }
    }
    outputData.push(row);
  }
  const res = await getBoundaryCodesHandler(outputData);
  return res;
}

async function enrichAndSaveResourceDetails(requestBody: any) {
  if (!requestBody?.ResourceDetails?.status) {
    requestBody.ResourceDetails.status = "data-accepted"
  }
  if (!requestBody?.ResourceDetails?.processedFileStoreId) {
    requestBody.ResourceDetails.processedFileStoreId = null
  }
  requestBody.ResourceDetails.id = uuidv4()
  requestBody.ResourceDetails.auditDetails = {
    createdTime: Date.now(),
    createdBy: requestBody.RequestInfo.userInfo?.uuid,
    lastModifiedTime: Date.now(),
    lastModifiedBy: requestBody.RequestInfo.userInfo?.uuid
  }
  requestBody.ResourceDetails.additionalDetails = { ...requestBody.ResourceDetails.additionalDetails, atttemptedData: requestBody?.ResourceDetails?.dataToCreate }
  delete requestBody.ResourceDetails.dataToCreate;
  produceModifiedMessages(requestBody, config.KAFKA_CREATE_RESOURCE_DETAILS_TOPIC)
}

async function getDataFromSheet(fileStoreId: any, tenantId: any, createAndSearchConfig: any) {
  const fileResponse = await httpRequest(config.host.filestore + config.paths.filestore + "/url", {}, { tenantId: tenantId, fileStoreIds: fileStoreId }, "get");
  if (!fileResponse?.fileStoreIds?.[0]?.url) {
    throw new Error("Not any download url returned for given fileStoreId")
  }
  return await getSheetData(fileResponse?.fileStoreIds?.[0]?.url, createAndSearchConfig?.parseArrayConfig?.sheetName)
}

function findColumns(desiredSheet: any): { statusColumn: string, errorDetailsColumn: string } {
  var range = XLSX.utils.decode_range(desiredSheet['!ref']);

  // Check if the status column already exists in the first row
  var statusColumn: any;
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    if (desiredSheet[cellAddress] && desiredSheet[cellAddress].v === '#status#') {
      statusColumn = String.fromCharCode(65 + col);
      for (let row = range.s.r; row <= range.e.r; row++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: statusColumn.charCodeAt(0) - 65 });
        delete desiredSheet[cellAddress];
      }
      break;
    }
  }

  // Check if the errorDetails column already exists in the first row
  var errorDetailsColumn: any;
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddress = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    if (desiredSheet[cellAddress] && desiredSheet[cellAddress].v === '#errorDetails#') {
      errorDetailsColumn = String.fromCharCode(65 + col);
      for (let row = range.s.r; row <= range.e.r; row++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: errorDetailsColumn.charCodeAt(0) - 65 });
        delete desiredSheet[cellAddress];
      }
      break;
    }
  }

  // If the status column doesn't exist, calculate the next available column
  range = XLSX.utils.decode_range(desiredSheet['!ref']);
  const emptyColumnIndex = range.e.c + 1;
  statusColumn = String.fromCharCode(65 + emptyColumnIndex);
  desiredSheet[statusColumn + '1'] = { v: '#status#', t: 's', r: '<t xml:space="preserve">#status#</t>', h: '#status#', w: '#status#' };

  // Calculate errorDetails column one column to the right of status column
  errorDetailsColumn = String.fromCharCode(statusColumn.charCodeAt(0) + 1);
  desiredSheet[errorDetailsColumn + '1'] = { v: '#errorDetails#', t: 's', r: '<t xml:space="preserve">#errorDetails#</t>', h: '#errorDetails#', w: '#errorDetails#' };

  return { statusColumn, errorDetailsColumn };
}


function processErrorData(request: any, createAndSearchConfig: any, workbook: any, sheetName: any) {
  const desiredSheet: any = workbook.Sheets[sheetName];
  const columns = findColumns(desiredSheet);
  const statusColumn = columns.statusColumn;
  const errorDetailsColumn = columns.errorDetailsColumn;

  const errorData = request.body.sheetErrorDetails;
  errorData.forEach((error: any) => {
    const rowIndex = error.rowNumber;
    if (error.isUniqueIdentifier) {
      const uniqueIdentifierCell = createAndSearchConfig.uniqueIdentifierColumn + (rowIndex + 1);
      desiredSheet[uniqueIdentifierCell] = { v: error.uniqueIdentifier, t: 's', r: '<t xml:space="preserve">#uniqueIdentifier#</t>', h: error.uniqueIdentifier, w: error.uniqueIdentifier };
    }

    const statusCell = statusColumn + (rowIndex + 1);
    const errorDetailsCell = errorDetailsColumn + (rowIndex + 1);
    desiredSheet[statusCell] = { v: error.status, t: 's', r: '<t xml:space="preserve">#status#</t>', h: error.status, w: error.status };
    desiredSheet[errorDetailsCell] = { v: error.errorDetails, t: 's', r: '<t xml:space="preserve">#errorDetails#</t>', h: error.errorDetails, w: error.errorDetails };

  });

  desiredSheet['!ref'] = desiredSheet['!ref'].replace(/:[A-Z]+/, ':' + errorDetailsColumn);
  workbook.Sheets[sheetName] = desiredSheet;
}

async function updateStatusFile(request: any) {
  const fileStoreId = request?.body?.ResourceDetails?.fileStoreId;
  const tenantId = request?.body?.ResourceDetails?.tenantId;
  const createAndSearchConfig = createAndSearch[request?.body?.ResourceDetails?.type];
  const fileResponse = await httpRequest(config.host.filestore + config.paths.filestore + "/url", {}, { tenantId: tenantId, fileStoreIds: fileStoreId }, "get");

  if (!fileResponse?.fileStoreIds?.[0]?.url) {
    throw new Error("No download URL returned for the given fileStoreId");
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/pdf',
  };

  const fileUrl = fileResponse?.fileStoreIds?.[0]?.url;
  const sheetName = createAndSearchConfig?.parseArrayConfig?.sheetName;
  const responseFile = await httpRequest(fileUrl, null, {}, 'get', 'arraybuffer', headers);
  const workbook = XLSX.read(responseFile, { type: 'buffer' });

  // Check if the specified sheet exists in the workbook
  if (!workbook.Sheets.hasOwnProperty(sheetName)) {
    throw new Error(`Sheet with name "${sheetName}" is not present in the file.`);
  }
  processErrorData(request, createAndSearchConfig, workbook, sheetName);

  const responseData = await createAndUploadFile(workbook, request);
  logger.info('File updated successfully:' + JSON.stringify(responseData));
  if (responseData?.[0]?.fileStoreId) {
    request.body.ResourceDetails.processedFileStoreId = responseData?.[0]?.fileStoreId;
  }
  else {
    throw new Error("Error in Creatring Status File");
  }
}


function convertToType(dataToSet: any, type: any) {
  switch (type) {
    case "string":
      return String(dataToSet);
    case "number":
      return Number(dataToSet);
    case "boolean":
      // Convert to boolean assuming any truthy value should be true and falsy should be false
      return Boolean(dataToSet);
    // Add more cases if needed for other types
    default:
      // If type is not recognized, keep dataToSet as it is
      return dataToSet;
  }
}

function setTenantId(
  resultantElement: any,
  requestBody: any,
  createAndSearchConfig: any
) {
  if (createAndSearchConfig?.parseArrayConfig?.tenantId) {
    const tenantId = _.get(requestBody, createAndSearchConfig?.parseArrayConfig?.tenantId?.getValueViaPath);
    _.set(resultantElement, createAndSearchConfig?.parseArrayConfig?.tenantId?.resultantPath, tenantId);
  }

}


function processData(dataFromSheet: any[], createAndSearchConfig: any) {
  const parseLogic = createAndSearchConfig?.parseArrayConfig?.parseLogic;
  const requiresToSearchFromSheet = createAndSearchConfig?.requiresToSearchFromSheet;
  var createData = [], searchData = [];
  for (const data of dataFromSheet) {
    const resultantElement: any = {};
    for (const element of parseLogic) {
      let dataToSet = _.get(data, element.sheetColumnName);
      if (element.conversionCondition) {
        dataToSet = element.conversionCondition[dataToSet];
      }
      if (element.type) {
        dataToSet = convertToType(dataToSet, element.type);
      }
      _.set(resultantElement, element.resultantPath, dataToSet);
    }
    resultantElement["!row#number!"] = data["!row#number!"];
    var addToCreate = true;
    for (const key of requiresToSearchFromSheet) {
      if (data[key.sheetColumnName]) {
        searchData.push(resultantElement)
        addToCreate = false;
        break;
      }
    }
    if (addToCreate) {
      createData.push(resultantElement)
    }
  }
  return { searchData, createData };
}

function setTenantIdAndSegregate(processedData: any, createAndSearchConfig: any, requestBody: any) {
  for (const resultantElement of processedData.createData) {
    setTenantId(resultantElement, requestBody, createAndSearchConfig);
  }
  for (const resultantElement of processedData.searchData) {
    setTenantId(resultantElement, requestBody, createAndSearchConfig);
  }
  return processedData;
}

// Original function divided into two parts
function convertToTypeData(dataFromSheet: any[], createAndSearchConfig: any, requestBody: any) {
  const processedData = processData(dataFromSheet, createAndSearchConfig);
  return setTenantIdAndSegregate(processedData, createAndSearchConfig, requestBody);
}

function updateActivityResourceId(request: any) {
  if (request?.body?.Activities && Array.isArray(request?.body?.Activities)) {
    for (const activity of request?.body?.Activities) {
      activity.resourceDetailsId = request?.body?.ResourceDetails?.id
    }
  }
}

async function generateProcessedFileAndPersist(request: any) {
  await updateStatusFile(request);
  updateActivityResourceId(request);
  logger.info("ResourceDetails to persist : " + JSON.stringify(request?.body?.ResourceDetails));
  logger.info("Activities to persist : " + JSON.stringify(request?.body?.Activities));
  produceModifiedMessages(request?.body, config.KAFKA_CREATE_RESOURCE_DETAILS_TOPIC);
  await new Promise(resolve => setTimeout(resolve, 2000));
  produceModifiedMessages(request?.body, config.KAFKA_CREATE_RESOURCE_ACTIVITY_TOPIC);
}


export {
  errorResponder,
  errorLogger,
  invalidPathHandler,
  getResponseInfo,
  throwError,
  sendResponse,
  appCache,
  cacheResponse,
  getCachedResponse,
  getCampaignDetails,
  generateSortingAndPaginationClauses,
  generateXlsxFromJson,
  generateAuditDetails,
  generateResourceMessage,
  generateActivityMessage,
  getResponseFromDb,
  callSearchApi,
  matchWithCreatedDetails,
  getCreationDetails,
  getSchemaAndProcessResult,
  getModifiedResponse,
  getNewEntryResponse,
  getOldEntryResponse,
  getFinalUpdatedResponse,
  fullProcessFlowForNewEntry,
  processValidationResultsAndSendResponse,
  modifyData,
  correctParentValues,
  sortCampaignDetails,
  processGenerateRequest,
  processGenerate,
  convertToFacilityCreateData,
  convertToFacilityExsistingData,
  enrichResourceDetails,
  getFacilityIds,
  matchFacilityData,
  autoGenerateBoundaryCodes,
  enrichAndSaveResourceDetails,
  getDataFromSheet,
  convertToTypeData,
  matchData,
  generateProcessedFileAndPersist
};


