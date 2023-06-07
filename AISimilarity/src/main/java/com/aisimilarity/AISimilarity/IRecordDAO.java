package com.aisimilarity.AISimilarity;

import java.util.List;

public interface IRecordDAO {

	List<Record> getAllRecords();

	List<Record> getRecord(long id);

	boolean updateRecord(long id, Record newRecord);

	boolean deleteRecord(long id);

}